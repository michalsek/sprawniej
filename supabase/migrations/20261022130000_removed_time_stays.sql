-- When someone left or was removed is the database's time, set once. Until now an admin could rewrite it for someone
-- already removed, which also moved the "made before you left" cutoff for invite links (private.let_in). Now a
-- change to it while they're out keeps the old time; nothing is refused, so two admins removing the same person at
-- once (or an older app sending its own time) still works. Coming back stays as before: only through an invite.

create or replace function private.guard_members() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_profile_id();
  my_role text;
begin
  if (select auth.uid()) is null or current_setting('sprawniej.trusted', true) = 'on' then return new; end if;
  if old.removed_at is not null and new.removed_at is null then
    raise exception 'Someone who left comes back with a new invite.' using errcode = '42501';
  end if;
  select m.role into my_role from public.workspace_members m
   where m.workspace_id = new.workspace_id and m.profile_id = me and m.removed_at is null;
  if (new.role is distinct from old.role and 'owner' in (old.role, new.role))
     or (old.role = 'owner' and old.removed_at is null and new.removed_at is not null) then
    if my_role is distinct from 'owner' then
      raise exception 'Only an owner can change who owns the workspace.' using errcode = '42501';
    end if;
  end if;
  if new.profile_id = me and new.role is distinct from old.role and my_role is distinct from 'owner' then
    raise exception 'You can''t change your own role.' using errcode = '42501';
  end if;
  if old.removed_at is null and new.removed_at is not null then new.removed_at := now(); end if;
  -- already out: the time they left stays
  if old.removed_at is not null then new.removed_at := old.removed_at; end if;
  return new;
end $$;
