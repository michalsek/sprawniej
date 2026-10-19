-- Owners and invites, phase 8 fixes. Safe to run again: everything here replaces what it changes.

-- Every workspace keeps at least one owner, also when two owners act at the same moment (demoting each other, both
-- leaving, removing each other). Changes that could take away an owner wait for each other per workspace, and each
-- one checks after the one before it is saved: plpgsql reads afresh for each query, so it sees what that one did.
create or replace function private.keep_an_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then return null; end if;
  if old.role = 'owner' and old.removed_at is null then
    perform pg_advisory_xact_lock(hashtextextended('sprawniej.owners:' || old.workspace_id::text, 0));
    if not exists (
         select 1 from public.workspace_members m
          where m.workspace_id = old.workspace_id and m.role = 'owner' and m.removed_at is null) then
      raise exception 'A workspace needs at least one owner. Make someone else an owner first.' using errcode = '23514';
    end if;
  end if;
  return null;
end $$;

-- The join page: as in 20261019000009, but a link that can't be used any more doesn't say whom it was for.
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
         coalesce(nullif(b.name, ''), b.login), b.login, b.avatar_url,
         case when x.st in ('open', 'member') then x.for_login end,
         case when x.st in ('open', 'member') then g.name end,
         x.role, x.st,
         case when x.st in ('open', 'member') then (
           select coalesce(jsonb_agg(jsonb_build_object('name', y.name, 'avatarUrl', y.avatar_url)), '[]'::jsonb)
             from (select coalesce(nullif(p.name, ''), p.login) as name, p.avatar_url
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
