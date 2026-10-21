-- Removes what ONE database test run (bun run test:db) left behind: the accounts dbtest-<run>-…, the workspaces
-- 'dbtest <run> …', the run's sign-up codes and the record of the accounts it made. Other runs, also ones still going,
-- are left alone. Every run does this itself when it ends (tests/db/cleanup.ts); to do it by hand:
--   bun run test:db:clean <run>        (also removes the run's pictures)
-- or, for the database only,
--   psql "<connection string>" -v run=<run> -f supabase/dev/cleanup-test-run.sql
-- A run's name is letters and digits only, so one run's names never start with another's.

begin;
-- the run's workspaces, with everything in them (their people from Linear too)
delete from public.workspaces where name like 'dbtest ' || :'run' || ' %';
-- the run's profiles, then its accounts
delete from public.profiles p using auth.users u where p.user_id = u.id and u.email like 'dbtest-' || :'run' || '-%';
delete from auth.users where email like 'dbtest-' || :'run' || '-%';
-- notes about rows of workspaces that are gone (nobody can read them; the nightly job would forget them after 45 days)
delete from public.deletions d where not exists (select 1 from public.workspaces w where w.id = d.workspace_id);
-- the run's sign-up codes and the record of the accounts it made
delete from private.signups where email like 'dbtest-' || :'run' || '-%';
delete from private.signup_codes where note like 'dbtest ' || :'run' || ' %';
commit;
