-- Contact emails: a person keeps a few emails teammates may write to (profile_emails, theirs alone) and picks the one
-- teammates see, or none (show_email). How they sign in doesn't change, and nothing here reads the sign-in email.
--
-- The chosen email is copied onto profiles.contact_email, filled by the database only (there is no grant for it). So
-- it travels with the profile like the name and the picture: everyone who can see the profile sees it (people who
-- are or were in a workspace with the person), it comes with opening and catching up, and a change is broadcast to
-- every workspace the person is or was in (private.broadcast sends the changed columns).
--
-- Locks: always the person's email rows first, then their profile row. Changing or deleting an email locks its row
-- and then the triggers refresh the profile; show_email locks the email rows (in id order) before the profile; adding
-- one locks only the profile (the new row isn't anyone else's to lock). So two tabs can't wait for each other.
--
-- The lines marked "-- @regex email" and "-- @max contact-emails" must match src/model/contactEmail.ts;
-- tests/contactEmail.test.ts reads the line right after each marker.

-- an email, roughly: something@domain.tld, no spaces, no spaces around it, up to 254 characters
create function private.valid_email(email text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(email = trim(email) and length(email) <= 254
    -- @regex email
    and email ~ '^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$', false)
$$;
-- the check on profile_emails runs as whoever adds or changes one
revoke execute on function private.valid_email(text) from public;
grant execute on function private.valid_email(text) to authenticated;

-- ---------- your emails ----------

create table public.profile_emails (
  id          uuid primary key default gen_random_uuid(),
  -- set by the a_author trigger; the default is only there so the generated types let the app leave it out
  -- (private.my_profile_id is granted to authenticated in the helpers file)
  profile_id  uuid not null default private.my_profile_id() references public.profiles (id) on delete cascade,
  email       text not null check (private.valid_email(email)),
  visible     boolean not null default false,                                    -- changed only by show_email()
  created_at  timestamptz not null default now(),
  changed_at  timestamptz not null default clock_timestamp()
);
-- the same email twice is refused, case aside (two people may share one); this also serves the foreign key
create unique index profile_emails_email on public.profile_emails (profile_id, lower(email));
-- at most one shown
create unique index profile_emails_visible on public.profile_emails (profile_id) where visible;

-- Not in private.wiring: it belongs to one person, not to a workspace, and is never broadcast.
alter table public.profile_emails enable row level security;
revoke all on public.profile_emails from anon, authenticated;
grant select, delete on public.profile_emails to authenticated;
grant insert (email) on public.profile_emails to authenticated;
grant update (email) on public.profile_emails to authenticated;
create policy "your own emails" on public.profile_emails for all to authenticated
  using (profile_id = (select private.my_profile_id()))
  with check (profile_id = (select private.my_profile_id()));

create trigger a_author before insert on public.profile_emails
  for each row execute function private.stamp_author('profile_id');
create trigger a_stamp before insert or update on public.profile_emails
  for each row execute function private.touch();

-- up to 5 each; the person's profile row is locked, so two adds at once can't both take the last place (the new row
-- isn't visible to anyone else yet, so this is the only lock it takes: no email row of theirs is waited for)
create function private.limit_emails() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.profiles where id = new.profile_id for no key update;
  if (select count(*) from public.profile_emails where profile_id = new.profile_id) >=
    -- @max contact-emails
    5
  then
    raise exception 'You can keep up to 5 emails. Remove one first.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger b_limit before insert on public.profile_emails
  for each row execute function private.limit_emails();

-- ---------- what teammates see ----------

alter table public.profiles add column contact_email text;   -- filled by the database (no grant), null: none shown

-- copies the person's shown email onto their profile; does nothing when it is already there (no message, no new
-- changed_at)
create function private.refresh_contact_email(p uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare shown text := (select e.email from public.profile_emails e where e.profile_id = p and e.visible);
begin
  update public.profiles set contact_email = shown where id = p and contact_email is distinct from shown;
end $$;

create function private.contact_email_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_contact_email(coalesce(new.profile_id, old.profile_id));
  return null;
end $$;
-- the shown one's text changed, or the shown one went (show_email refreshes by itself)
create trigger contact_email_edited after update of email on public.profile_emails
  for each row when (new.visible and old.email is distinct from new.email)
  execute function private.contact_email_changed();
create trigger contact_email_gone after delete on public.profile_emails
  for each row when (old.visible) execute function private.contact_email_changed();

-- Picks the email teammates see; none (or null) shows none.
create function public.show_email(p_email uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.my_profile_id();
begin
  if me is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  -- one choice at a time; email rows before the profile, like editing and deleting one (see the top of this file)
  perform 1 from public.profile_emails where profile_id = me order by id for update;
  perform 1 from public.profiles where id = me for no key update;
  if p_email is not null and not exists (select 1 from public.profile_emails where id = p_email and profile_id = me) then
    raise exception 'That email isn''t in your list any more.' using errcode = 'P0002';
  end if;
  -- the old one goes first, so the "one shown" index never trips
  update public.profile_emails set visible = false where profile_id = me and visible and id is distinct from p_email;
  update public.profile_emails set visible = true where id = p_email and not visible;
  perform private.refresh_contact_email(me);                              -- one message per workspace
end $$;
revoke execute on function public.show_email(uuid) from public;
grant execute on function public.show_email(uuid) to authenticated;

-- ---------- a deleted account ----------
-- Deleting an account keeps its profile (profiles.user_id becomes null, so the name stays on old work), but its
-- contact emails go: teammates see none from then on, and a later GitHub sign-in that claims the profile starts with
-- an empty list. The profile is locked here before the email rows; an account is deleted while nobody is using it.
create function private.account_gone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_when = 'BEFORE' then
    new.contact_email := null;                       -- in the same message as user_id
    return new;
  end if;
  delete from public.profile_emails where profile_id = new.id;
  return null;
end $$;
create trigger b_account_gone before update of user_id on public.profiles
  for each row when (old.user_id is not null and new.user_id is null)
  execute function private.account_gone();
create trigger account_gone after update of user_id on public.profiles
  for each row when (old.user_id is not null and new.user_id is null)
  execute function private.account_gone();
