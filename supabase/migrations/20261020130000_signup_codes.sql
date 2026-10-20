-- Sign-up codes (docs/data-format.md, "Who may make an account"). A new account needs a sign-up code or an open
-- invite link:
--   * email and password: checked by Supabase Auth's "before user created" hook (private.before_user_created, switched
--     on in config.toml), before the account is written at all;
--   * GitHub (which can't carry a code): the account is made, but it gets no profile, so it can do nothing, until it
--     gives a code or an invite with use_signup_code(). Such accounts are removed after 7 days.
-- Whoever looks after Sprawniej makes and switches off codes in the SQL editor (docs/supabase-setup.md).

-- ---------- tables ----------

create table private.signup_codes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code ~ '^[A-Z0-9]{8,64}$'),
  note            text not null default '',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  max_uses        integer not null check (max_uses >= 1),
  uses            integer not null default 0 check (uses >= 0),
  switched_off_at timestamptz
);

-- Every account that was let in, and with what. A row here is what lets an account have a profile.
create table private.signups (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  user_id   uuid not null unique,                   -- no foreign key: the hook runs before the account is written
  email     text,
  provider  text,
  code_id   uuid references private.signup_codes (id) on delete set null,
  invite_id uuid references public.invites (id) on delete set null
);
create index signups_code_id on private.signups (code_id);
create index signups_invite_id on private.signups (invite_id);

revoke all on private.signup_codes, private.signups from public, anon, authenticated;

-- Accounts made before sign-up codes were needed are let in already.
insert into private.signups (at, user_id, email, provider)
select u.created_at, u.id, u.email, u.raw_app_meta_data ->> 'provider' from auth.users u
on conflict (user_id) do nothing;

-- ---------- the check ----------

-- Lets an account in with an invite link (one account per link) or a sign-up code, and writes it down. Returns null
-- when it did, or the reason it didn't, in words for people (src/backend/auth.ts knows each one).
create function private.let_in(p_user uuid, p_email text, p_provider text, p_code text, p_invite text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  wanted text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  inv uuid;
  c private.signup_codes;
begin
  if exists (select 1 from private.signups s where s.user_id = p_user) then return null; end if;
  if coalesce(p_invite, '') <> '' then
    select i.id into inv from public.invites i
     where i.token = p_invite and i.accepted_at is null and i.expires_at > now()
       and not exists (select 1 from private.signups s where s.invite_id = i.id)
     for update;
    if found then
      insert into private.signups (user_id, email, provider, invite_id) values (p_user, p_email, p_provider, inv);
      return null;
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

-- The "before user created" hook. An email (or phone, or anonymous) account must bring its code or invite in its
-- metadata (signUp's options.data: signup_code, invite). Other ways (GitHub) can't, so they are let through without a
-- profile and asked for a code afterwards (use_signup_code).
create function private.before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u jsonb := event -> 'user';
  provider text := coalesce(u -> 'app_metadata' ->> 'provider', 'email');
  why text;
begin
  if provider not in ('email', 'phone') and coalesce((u ->> 'is_anonymous')::boolean, false) = false then
    return '{}'::jsonb;
  end if;
  why := private.let_in((u ->> 'id')::uuid, nullif(u ->> 'email', ''), provider,
                        u -> 'user_metadata' ->> 'signup_code', u -> 'user_metadata' ->> 'invite');
  if why is null then return '{}'::jsonb; end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', why));
end $$;

grant usage on schema private to supabase_auth_admin;
grant execute on function private.before_user_created(jsonb) to supabase_auth_admin;

-- No profile for an account that wasn't let in (a GitHub sign-up without a code yet). People from Linear (no account)
-- and claiming a profile made for a GitHub id (an update) aren't checked.
create function private.must_be_let_in() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null and not exists (select 1 from private.signups s where s.user_id = new.user_id) then
    raise exception 'You need a sign-up code to make an account. Ask whoever looks after Sprawniej for one.'
      using errcode = 'SP004';
  end if;
  return new;
end $$;

create trigger a_let_in before insert on public.profiles
  for each row execute function private.must_be_let_in();

-- ---------- for the app ----------

-- True while you're signed in without a profile and weren't let in yet: the name step asks for a code too.
create function public.signup_code_needed() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
     and not exists (select 1 from public.profiles p where p.user_id = (select auth.uid()))
     and not exists (select 1 from private.signups s where s.user_id = (select auth.uid()));
$$;

-- Lets you in with a sign-up code or an invite link's token, after a sign-up that couldn't bring one (GitHub). Does
-- nothing if you're in already.
create function public.use_signup_code(p_code text default null, p_invite text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  why text;
begin
  if uid is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  select private.let_in(uid, u.email, u.raw_app_meta_data ->> 'provider', p_code, p_invite) into why
    from auth.users u where u.id = uid;
  if why is not null then raise exception '%', why using errcode = 'SP005'; end if;
end $$;

grant execute on function public.signup_code_needed(), public.use_signup_code(text, text) to authenticated;

-- ---------- for whoever looks after Sprawniej (SQL editor) ----------

-- select private.make_signup_code('Ania and Bartek', 7, 2): a new code, shown as K7QX-M2PA-9RTD.
create function private.make_signup_code(p_note text, p_days integer default 14, p_uses integer default 1) returns text
language plpgsql set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   -- no 0 O 1 I L
  b bytea;
  c text;
begin
  if coalesce(p_days, 0) < 1 then raise exception 'Days must be 1 or more.'; end if;
  if coalesce(p_uses, 0) < 1 then raise exception 'Uses must be 1 or more.'; end if;
  loop
    b := extensions.gen_random_bytes(12);
    c := '';
    for i in 0..11 loop
      c := c || substr(alphabet, get_byte(b, i) % length(alphabet) + 1, 1);
    end loop;
    insert into private.signup_codes (code, note, expires_at, max_uses)
    values (c, coalesce(p_note, ''), now() + make_interval(days => p_days), p_uses)
    on conflict (code) do nothing;
    exit when found;
  end loop;
  return substr(c, 1, 4) || '-' || substr(c, 5, 4) || '-' || substr(c, 9, 4);
end $$;

-- select private.switch_off_signup_code('K7QX-M2PA-9RTD'): it stops working at once.
create function private.switch_off_signup_code(p_code text) returns text
language plpgsql set search_path = '' as $$
begin
  update private.signup_codes set switched_off_at = coalesce(switched_off_at, now())
   where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if not found then raise exception 'There is no code %.', p_code; end if;
  return 'Switched off';
end $$;

-- ---------- nightly ----------

-- Accounts that were never let in (a GitHub sign-up that gave no code) go after 7 days.
create function private.forget_strangers() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from auth.users u
   where u.created_at < now() - interval '7 days'
     and not exists (select 1 from private.signups s where s.user_id = u.id)
     and not exists (select 1 from public.profiles p where p.user_id = u.id);
  get diagnostics n = row_count;
  return n;
end $$;

select cron.schedule('sprawniej-forget-strangers', '47 2 * * *', 'select private.forget_strangers()');
