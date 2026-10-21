-- Views can keep filters as a tree (filters.tree: conditions and groups joined by and / or, see docs/data-format.md).
-- Linking a person from Linear to a member now also moves their login inside that tree, not only in the flat
-- assignees and subscribers lists. swap_login and move_person are as in 20261019000006_functions.sql, except for that.

-- Swaps one login for another in a view's assignees and subscribers filters, keeping the order, dropping repeats and
-- leaving null (no assignee) as it is (P10). Inside the tree, every value that is that login becomes the other one: a
-- guest's login starts with ~ and is matched with its quotes, so "~jan" never matches inside "~jan-k". A repeat this
-- leaves in a condition is harmless; the app tidies it away on the next change.
create or replace function private.swap_login(f jsonb, from_login text, to_login text) returns jsonb
language sql immutable set search_path = '' as $$
  select f || coalesce((
    select jsonb_object_agg(k, (
      select coalesce(jsonb_agg(d.x order by d.first_n), '[]'::jsonb) from (
        select s.x, min(s.n) as first_n from (
          select case when a.e = to_jsonb(from_login) then to_jsonb(to_login) else a.e end as x, a.n
            from jsonb_array_elements(f -> k) with ordinality as a(e, n)) s
        group by s.x) d))
    from unnest(array['assignees', 'subscribers']) k
    where jsonb_typeof(f -> k) = 'array'), '{}'::jsonb)
  || case when jsonb_typeof(f -> 'tree') = 'object'
       then jsonb_build_object('tree', replace((f -> 'tree')::text, to_jsonb(from_login)::text, to_jsonb(to_login)::text)::jsonb)
       else '{}'::jsonb end
$$;

-- A person from Linear who hadn't joined is this person: every reference moves over and the guest goes. Quietly (no
-- history, no per-row broadcasts), then one catch-up message for the workspace.
create or replace function private.move_person(p_guest uuid, p_to uuid, p_ws uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.profiles;
  t public.profiles;
begin
  select * into g from public.profiles where id = p_guest and guest_of = p_ws for update;
  if not found then raise exception 'That person isn''t here any more.' using errcode = 'P0002'; end if;
  select * into t from public.profiles where id = p_to for update;
  if not found or t.guest_of is not null then
    raise exception 'You can only link someone to a person who has joined.' using errcode = '22023';
  end if;
  perform set_config('sprawniej.importing', 'on', true);
  -- they join the teams the guest's issues are in, and the guest's teams
  insert into public.team_members (workspace_id, team_id, profile_id)
  select distinct p_ws, x.team_id, p_to from (
    select i.team_id from public.issues i
     where i.workspace_id = p_ws and (i.assignee_id = p_guest or i.created_by = p_guest)
    union
    select tm.team_id from public.team_members tm where tm.workspace_id = p_ws and tm.profile_id = p_guest) x
  on conflict (team_id, profile_id) do nothing;
  update public.issues       set assignee_id = p_to where workspace_id = p_ws and assignee_id = p_guest;
  update public.issues       set created_by  = p_to where workspace_id = p_ws and created_by  = p_guest;
  update public.issues       set archived_by = p_to where workspace_id = p_ws and archived_by = p_guest;
  update public.comments     set author_id   = p_to where workspace_id = p_ws and author_id   = p_guest;
  update public.projects     set lead_id     = p_to where workspace_id = p_ws and lead_id     = p_guest;
  update public.views        set owner_id    = p_to where workspace_id = p_ws and owner_id    = p_guest;
  update public.inbox        set actor_id    = p_to where workspace_id = p_ws and actor_id    = p_guest;
  update public.issue_events set actor_id    = p_to where workspace_id = p_ws and actor_id    = p_guest;
  -- ids inside the history ({"assignee": [old, new]})
  update public.issue_events e
     set changes = jsonb_set(e.changes, '{assignee}',
       (select jsonb_agg(case when a.v = to_jsonb(p_guest::text) then to_jsonb(p_to::text) else a.v end order by a.n)
          from jsonb_array_elements(e.changes -> 'assignee') with ordinality a(v, n)))
   where e.workspace_id = p_ws and e.changes -> 'assignee' @> jsonb_build_array(p_guest::text);
  -- logins inside view filters, the flat lists and the tree
  update public.views v set filters = private.swap_login(v.filters, g.login, t.login)
   where v.workspace_id = p_ws
     and (v.filters -> 'assignees' @> jsonb_build_array(g.login)
          or v.filters -> 'subscribers' @> jsonb_build_array(g.login)
          or strpos(coalesce(v.filters -> 'tree', 'null')::text, to_jsonb(g.login)::text) > 0);
  insert into public.issue_followers (workspace_id, issue_id, profile_id, following)
  select f.workspace_id, f.issue_id, p_to, f.following from public.issue_followers f
   where f.workspace_id = p_ws and f.profile_id = p_guest
  on conflict (issue_id, profile_id) do nothing;
  update public.profiles set
      linear_ids = (select coalesce(array_agg(distinct x), '{}') from unnest(t.linear_ids || g.linear_ids) x),
      name = case when t.name = '' or t.name = t.login then g.name else t.name end,
      avatar_url = case when t.avatar_url = '' then g.avatar_url else t.avatar_url end
   where id = p_to;
  delete from public.invites where for_profile = p_guest and accepted_at is null;
  delete from public.profiles where id = p_guest;          -- the forget trigger notes it under guest_of (P10)
  perform set_config('sprawniej.importing', 'off', true);
  perform realtime.send(jsonb_build_object('op', 'catch_up'), 'change', 'ws:' || p_ws, true);
end $$;
