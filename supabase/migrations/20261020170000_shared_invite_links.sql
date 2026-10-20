-- Invite links for several people (docs/data-format.md, invites and invite_uses). A link is for one person (as
-- before), for up to a number of people, or for anyone who has it, until it expires or an admin ends it early. Who
-- joined with which link is kept, one row per person. Older apps keep working: a link they make is for one person,
-- and every link made before this file stays one.
--
-- New error codes (the list is at the top of 20261019000006_functions.sql):
--   SP006  the invite link was ended
--   SP007  the invite link is full
--   SP008  the invite link was made before you left the workspace

-- ---------- how many people a link is for, and ending it ----------

-- max_uses: 1 is one person (the default, so older apps and older links stay single-use), a number up to 1000 is up
-- to that many people, null is anyone with the link. ended_at: an admin ended it early (end_invite), for good.
alter table public.invites
  add column max_uses integer default 1 check (max_uses is null or max_uses between 1 and 1000),
  add column ended_at timestamptz,
  -- a link for a person from Linear turns whoever accepts it into them, so only one person can
  add constraint invites_guest_once check (for_profile is null or coalesce(max_uses, 0) = 1);

-- ended_at is set only by end_invite, so the app never sends a time; nobody changes max_uses afterwards
grant insert (max_uses) on public.invites to authenticated;

-- ---------- who joined with which link ----------

create table public.invite_uses (
  invite_id     uuid not null references public.invites (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  at            timestamptz not null default now(),
  primary key (invite_id, profile_id)
);
create index invite_uses_profile on public.invite_uses (profile_id);
create index invite_uses_workspace on public.invite_uses (workspace_id);

-- Not broadcast: like invites, admins read them when Settings opens.
insert into private.wiring (name, keys, ws_col, topic, topic_col, policies, stamp, forget) values
  ('invite_uses',       '{invite_id,profile_id}',    'workspace_id', null,  null,           null,                null,            false);
call private.wire('invite_uses');

-- admins and owners read them; only accept_invite writes them, so there is no other policy and no write grant
create policy "admins read invite uses" on public.invite_uses for select to authenticated
  using (workspace_id in (select private.my_admin_workspaces()));

-- the links accepted so far, each with its record (one whose person's profile was deleted since has none, and stays
-- used through accepted_at)
insert into public.invite_uses (invite_id, workspace_id, profile_id, at)
select i.id, i.workspace_id, i.accepted_by, i.accepted_at from public.invites i
 where i.accepted_by is not null and i.accepted_at is not null
on conflict do nothing;

-- ---------- the state of a link ----------

-- Why a link can't be used, or 'open', for the person `p_me` (null: someone without a profile yet). Whether they are
-- in the workspace already is asked first, by the callers. In this order:
--   used     a link for one person that was accepted (links made before this file, too)
--   ended    an admin ended it
--   full     as many people as it allows joined with it
--   expired  its time is over
--   left     it was made before you left the workspace or were removed: coming back takes a newer link
-- Called after the invite's row lock (accept_invite, let_in), in a statement of its own, so it counts what the one
-- before it saved. Only the functions here call it, as its owner, so it needs no security definer of its own.
create function private.invite_state(inv public.invites, p_me uuid) returns text
language sql stable set search_path = '' as $$
  select case
    when inv.accepted_at is not null
      or (inv.max_uses = 1 and exists (select 1 from public.invite_uses u where u.invite_id = inv.id)) then 'used'
    when inv.ended_at is not null then 'ended'
    when inv.max_uses > 1 and (select count(*) from public.invite_uses u where u.invite_id = inv.id) >= inv.max_uses then 'full'
    when inv.expires_at < now() then 'expired'
    when exists (select 1 from public.workspace_members m
                  where m.workspace_id = inv.workspace_id and m.profile_id = p_me and m.removed_at >= inv.created_at) then 'left'
    else 'open' end
$$;

-- The join page: as in 20261019000010, with the new states ended, full and left.
create or replace function public.invite_info(p_token text)
returns table (workspace_id uuid, workspace_name text, invited_by_name text, invited_by_login text,
               invited_by_avatar text, for_login text, for_name text, role text, state text, people jsonb)
language sql stable security definer set search_path = '' as $$
  with x as (
    select i.*, w.name as ws_name,
           case when exists (select 1 from public.workspace_members m where m.workspace_id = i.workspace_id
                             and m.profile_id = (select private.my_profile_id()) and m.removed_at is null) then 'member'
                else private.invite_state(i, (select private.my_profile_id())) end as st
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

-- ---------- joining ----------

-- Makes you a member (or brings you back) and writes down that you joined with this link. A link for one person is
-- marked used as before. Two people at the last place: both wait for the invite's row lock, and the second one counts
-- after the first is saved, so it gets SP007. Someone already in uses no place.
create or replace function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_profile_id();
  inv public.invites;
  st text;
begin
  if me is null then raise exception 'Pick your name first.' using errcode = '42501'; end if;
  select * into inv from public.invites where token = p_token for update;
  if not found then
    raise exception 'This invite link doesn''t work. Ask for a new one.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.workspace_members m where m.workspace_id = inv.workspace_id
             and m.profile_id = me and m.removed_at is null) then
    return inv.workspace_id;                                 -- already in
  end if;
  st := private.invite_state(inv, me);
  if st = 'used' then
    raise exception 'This invite was already used. Ask for a new one.' using errcode = 'SP002';
  elsif st = 'ended' then
    raise exception 'This invite link was ended. Ask for a new one.' using errcode = 'SP006';
  elsif st = 'full' then
    raise exception 'This invite link is full. Ask for a new one.' using errcode = 'SP007';
  elsif st = 'expired' then
    raise exception 'This invite has expired. Ask for a new one.' using errcode = 'SP003';
  elsif st = 'left' then
    raise exception 'This link was made before you left. Ask for a new one.' using errcode = 'SP008';
  end if;
  perform set_config('sprawniej.trusted', 'on', true);
  insert into public.workspace_members (workspace_id, profile_id, role) values (inv.workspace_id, me, inv.role)
  on conflict (workspace_id, profile_id) do update set removed_at = null, role = excluded.role, joined_at = now();
  insert into public.invite_uses (invite_id, workspace_id, profile_id) values (inv.id, inv.workspace_id, me)
  on conflict do nothing;
  -- before the move: removing the guest sets for_profile to null
  if inv.max_uses = 1 then
    update public.invites set accepted_by = me, accepted_at = now() where id = inv.id;
  end if;
  if inv.for_profile is not null and exists (select 1 from public.profiles g
                                             where g.id = inv.for_profile and g.guest_of = inv.workspace_id) then
    perform private.move_person(inv.for_profile, me, inv.workspace_id);
  end if;
  insert into public.read_state (profile_id, workspace_id) values (me, inv.workspace_id) on conflict do nothing;
  perform set_config('sprawniej.trusted', 'off', true);
  return inv.workspace_id;
end $$;

-- ---------- making an account with a link ----------

-- As in 20261020130000, but an invite link lets in as many new accounts as it has places. A place is taken by
-- everyone who joined with it, and by every account made with it that isn't in the workspace yet (one whose account
-- was deleted no longer counts; one made in the last ten minutes always does, since the hook runs before the account
-- is written; one with the same email is this person trying again, after Auth failed). Joining counts only who
-- joined, so an account that never joins can't keep a real person out. A link for anyone makes accounts until it ends
-- or expires. A link that can't be used refuses with the same sentence as before, which older apps know; one whose
-- places are all held by accounts still being made says so.
create or replace function private.let_in(p_user uuid, p_email text, p_provider text, p_code text, p_invite text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  wanted text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  inv public.invites;
  st text;
  taken integer;
  c private.signup_codes;
begin
  if exists (select 1 from private.signups s where s.user_id = p_user) then return null; end if;
  if coalesce(p_invite, '') <> '' then
    select * into inv from public.invites i where i.token = p_invite for update;
    if found then
      st := private.invite_state(inv, null);
      if st = 'open' and inv.max_uses is not null then
        select (select count(*) from public.invite_uses u where u.invite_id = inv.id)
             + (select count(*) from private.signups s
                 where s.invite_id = inv.id
                   and s.email is distinct from p_email
                   and (s.at > now() - interval '10 minutes' or exists (select 1 from auth.users a where a.id = s.user_id))
                   and not exists (select 1 from public.workspace_members m join public.profiles p on p.id = m.profile_id
                                    where m.workspace_id = inv.workspace_id and p.user_id = s.user_id))
          into taken;
      end if;
      if st = 'open' and (inv.max_uses is null or taken < inv.max_uses) then
        insert into private.signups (user_id, email, provider, invite_id) values (p_user, p_email, p_provider, inv.id);
        return null;
      end if;
    end if;
    if wanted = '' and st = 'open' then
      -- @message signup
      return 'This invite link has no places left right now. Ask for a new one.';
    end if;
    if wanted = '' then
      -- @message signup
      return 'This invite link was already used or has expired. Ask for a new one.';
    end if;
  end if;
  if wanted = '' then
    -- @message signup
    return 'You need a sign-up code to make an account. Ask whoever looks after Sprawniej for one.';
  end if;
  select * into c from private.signup_codes where code = wanted for update;
  if not found then
    -- @message signup
    return 'That sign-up code doesn''t work. Check it and try again.';
  end if;
  if c.switched_off_at is not null or c.expires_at <= now() then
    -- @message signup
    return 'That sign-up code no longer works. Ask whoever looks after Sprawniej for a new one.';
  end if;
  if c.uses >= c.max_uses then
    -- @message signup
    return 'That sign-up code has been used up. Ask whoever looks after Sprawniej for a new one.';
  end if;
  update private.signup_codes set uses = uses + 1 where id = c.id;
  insert into private.signups (user_id, email, provider, code_id) values (p_user, p_email, p_provider, c.id);
  return null;
end $$;

-- ---------- ending a link early ----------

-- Admins and owners: nobody new can join or make an account with it from now on. Who joined stays written down.
-- Ending twice keeps the first time. It can't be undone: make a new link. An unknown link, or one of a workspace you
-- don't run, is "already deleted", so ids say nothing.
create function public.end_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.invites set ended_at = coalesce(ended_at, now())
   where id = p_invite and workspace_id in (select private.my_admin_workspaces());
  if not found then raise exception 'That link was already deleted.' using errcode = 'P0002'; end if;
end $$;

grant execute on function public.end_invite(uuid) to authenticated;
