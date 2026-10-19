-- Invites, phase 8. Safe to run again: everything here replaces or checks first.

-- The join page shows who invited you before you sign in. Anyone holding the link (144 random bits) sees the
-- workspace's name, who invited them and up to 8 faces; a used or expired link shows no faces; the workspace's id
-- only to someone who is already in it. Never the token, never an email. An unknown token gives no rows.
-- state: member (you're already in), used, expired or open.
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
         coalesce(nullif(b.name, ''), b.login), b.login, b.avatar_url, x.for_login, g.name, x.role, x.st,
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

-- A link works for 14 days (the default); nobody can make one that lasts longer than 30 (E127). created_at can't be
-- changed by anyone, so this holds for updates too.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invites_expire_soon' and conrelid = 'public.invites'::regclass) then
    alter table public.invites add constraint invites_expire_soon check (expires_at <= created_at + interval '30 days');
  end if;
end $$;
