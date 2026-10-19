-- Nightly jobs (docs/supabase-plan.md, section 4): what tidyArchive and tidyInbox did in the browser.
-- cron.schedule with a name that exists replaces that job, so applying this file again is safe.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

-- Finished issues untouched for longer than their team's auto_archive months are archived; 0 means never.
-- "Untouched" is the later of completed_at and updated_at, as in tidyArchive (P17). greatest() skips nulls.
-- It runs with no signed-in person, so the history says "archived" with no one behind it.
create function private.auto_archive() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.issues i set archived_at = now()
    from public.teams t
   where t.id = i.team_id and t.auto_archive > 0 and i.archived_at is null
     and i.status in (
       -- @list closed-statuses
       'done', 'canceled', 'duplicate'
     )
     and greatest(i.completed_at, i.updated_at) < now() - make_interval(months => t.auto_archive);
  get diagnostics n = row_count;
  return n;
end $$;

-- Read notes go after 30 days, unread ones after 90 (INBOX_KEEP).
create function private.tidy_inboxes() returns integer
language plpgsql security definer set search_path = '' as $$
declare gone integer;
begin
  delete from public.inbox x
   where x.at < now() - interval '90 days'
      or (x.at < now() - interval '30 days'
          and (x.read_at is not null
               or exists (select 1 from public.read_state r
                           where r.profile_id = x.recipient_id and r.workspace_id = x.workspace_id
                             and x.at <= r.read_until)));
  get diagnostics gone = row_count;
  return gone;
end $$;

-- Deletions are kept 45 days; a browser away for longer loads everything again.
create function private.forget_deletions() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from public.deletions where deleted_at < now() - interval '45 days';
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_profile_id(), private.my_workspaces(), private.my_admin_workspaces(),
  private.my_owner_workspaces(), private.my_people() to authenticated;

select cron.schedule('sprawniej-auto-archive',     '17 2 * * *', 'select private.auto_archive()');
select cron.schedule('sprawniej-tidy-inboxes',     '27 2 * * *', 'select private.tidy_inboxes()');
select cron.schedule('sprawniej-forget-deletions', '37 2 * * *', 'select private.forget_deletions()');
