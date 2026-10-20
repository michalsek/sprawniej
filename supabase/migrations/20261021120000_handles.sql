-- Changeable @handles (docs/data-format.md, profiles). `login` stays the hidden key that never changes: filters,
-- history and everything else keep pointing at it. `handle` is the @name people see and mention; null means the same
-- as the login. You change it with set_handle(). Nothing is kept for you: once you move off a handle anyone may take
-- it, and old text that says @old is plain text from then on.

alter table public.profiles add column handle text
  check (handle is null or (guest_of is null and private.valid_login(handle)));

-- What people see is unique among people with accounts, case aside, so nobody can take a handle someone uses now
-- (or the login of someone who never changed it). Logins stay unique too (profiles_login): a new sign-up can't pick
-- anyone's login, even one its owner moved off. ensure_profile's "on conflict do nothing" covers this index as well,
-- so a GitHub login that is someone's handle means "pick a name", not an error.
create unique index profiles_handle on public.profiles (lower(coalesce(handle, login))) where guest_of is null;

-- Changes your @handle. Your own login stores null; a change of case only is allowed. 22023: not a handle; 23505:
-- someone else uses it now.
create function public.set_handle(p_handle text) returns setof public.profiles rows 1
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  wanted text := trim(coalesce(p_handle, ''));
  me public.profiles;
begin
  if uid is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  select * into me from public.profiles where user_id = uid for update;
  if not found then raise exception 'Pick your name first.' using errcode = '42501'; end if;
  if not private.valid_login(wanted) then
    raise exception 'Use up to 39 letters, digits and dashes, starting with a letter or a digit.' using errcode = '22023';
  end if;
  if wanted is distinct from coalesce(me.handle, me.login) then
    begin
      update public.profiles set handle = nullif(wanted, me.login) where id = me.id returning * into me;
    exception when unique_violation then
      raise exception 'Someone already uses @%. Pick another one.', wanted using errcode = '23505';
    end;
  end if;
  return next me;
end $$;

revoke execute on function public.set_handle(text) from public;
grant execute on function public.set_handle(text) to authenticated;

-- The join page: as in 20261019000010_owner_lock.sql, with the inviter's handle as it is now.
create or replace function public.invite_info(p_token text)
returns table (workspace_id uuid, workspace_name text, invited_by_name text, invited_by_login text,
               invited_by_avatar text, for_login text, for_name text, role text, state text, people jsonb)
language sql stable security definer set search_path = '' as $$
  with x as (
    select i.*, w.name as ws_name,
           case when exists (select 1 from public.workspace_members m where m.workspace_id = i.workspace_id
                             and m.profile_id = (select private.my_profile_id()) and m.removed_at is null) then 'member'
                when i.accepted_at is not null then 'used'
                when i.expires_at < now() then 'expired'
                else 'open' end as st
      from public.invites i join public.workspaces w on w.id = i.workspace_id
     where i.token = p_token)
  select case when x.st = 'member' then x.workspace_id end, x.ws_name,
         coalesce(nullif(b.name, ''), b.handle, b.login), coalesce(b.handle, b.login), b.avatar_url,
         case when x.st in ('open', 'member') then x.for_login end,
         case when x.st in ('open', 'member') then g.name end,
         x.role, x.st,
         case when x.st in ('open', 'member') then (
           select coalesce(jsonb_agg(jsonb_build_object('name', y.name, 'avatarUrl', y.avatar_url)), '[]'::jsonb)
             from (select coalesce(nullif(p.name, ''), p.handle, p.login) as name, p.avatar_url
                     from public.workspace_members m join public.profiles p on p.id = m.profile_id
                    where m.workspace_id = x.workspace_id and m.removed_at is null
                    order by m.joined_at limit 8) y)
         else '[]'::jsonb end
    from x
    left join public.profiles b on b.id = x.invited_by
    left join public.profiles g on g.id = x.for_profile
$$;

revoke execute on function public.invite_info(text) from public;
grant execute on function public.invite_info(text) to anon, authenticated;

-- The webhook: as in 20261020120000_github.sql, with each member's handle (null: the same as the login), so a
-- mention of someone's handle makes them a follower there too.
create or replace function public.github_lookup(p_repository_id bigint, p_repo text, p_author bigint, p_refs text[])
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  refs text[] := (select coalesce(array_agg(distinct upper(r)), '{}') from unnest(p_refs[1:50]) r);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'connection', c.id,
      'workspace', c.workspace_id,
      'actor', (select p.id from public.profiles p
                  join public.workspace_members m on m.profile_id = p.id
                 where p.github_id = p_author and p.user_id is not null
                   and m.workspace_id = c.workspace_id and m.removed_at is null),
      'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'login', p.login, 'handle', p.handle))
                            from public.workspace_members m join public.profiles p on p.id = m.profile_id
                           where m.workspace_id = c.workspace_id and m.removed_at is null), '[]'),
      'issues', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'ref', t.key || '-' || i.number,
          'former_refs', to_jsonb(i.former_refs),
          'status', i.status,
          'created_by', i.created_by,
          'assignee_id', i.assignee_id,
          'description', i.description,
          'followers', coalesce((select jsonb_agg(jsonb_build_object('profile_id', f.profile_id, 'following', f.following))
                                   from public.issue_followers f where f.issue_id = i.id), '[]'),
          'comments', coalesce((select jsonb_agg(jsonb_build_object('author_id', k.author_id, 'body', k.body)
                                                 order by k.created_at)
                                  from public.comments k where k.issue_id = i.id), '[]')))
          from public.issues i join public.teams t on t.id = i.team_id
         where i.workspace_id = c.workspace_id and i.archived_at is null
           and ((t.key || '-' || i.number) = any(refs) or i.former_refs && refs)), '[]')))
      from public.github_repos c
     where c.repository_id = p_repository_id
        or (c.repository_id is null and lower(c.repo) = lower(p_repo))), '[]');
end $$;

revoke execute on function public.github_lookup(bigint, text, bigint, text[]) from public;
grant execute on function public.github_lookup(bigint, text, bigint, text[]) to service_role;
