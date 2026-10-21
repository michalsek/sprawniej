-- Removes what EVERY database test run (bun run test:db) left behind: their workspaces, profiles and sign-in accounts.
-- Only when no other test run is going (it removes a run that is still going too), and only on a project where every
-- dbtest-… account and 'dbtest …' workspace is a test's. To clean one run, use cleanup-test-run.sql instead
-- (bun run test:db:clean <run>); each run does that itself when it ends.
-- Run it with
--   bun run test:db:clean --all        (also removes the test runs' pictures)
-- or, for the database only,
--   bunx supabase db query --linked -f supabase/dev/cleanup-all-tests.sql
-- Pictures stay in the "pictures" bucket when the SQL runs alone (the database can't delete files).

begin;
-- the test workspaces, with everything in them (their people from Linear too)
delete from public.workspaces where name like 'dbtest %';
-- the test accounts' profiles, then the accounts
delete from public.profiles p using auth.users u where p.user_id = u.id and u.email like 'dbtest-%';
delete from auth.users where email like 'dbtest-%';
-- notes about rows of workspaces that are gone (the nightly job would forget them after 45 days)
delete from public.deletions d where not exists (select 1 from public.workspaces w where w.id = d.workspace_id);
-- the test runs' sign-up codes and the record of the accounts they made
delete from private.signups where email like 'dbtest-%';
delete from private.signup_codes where note like 'dbtest %';
commit;
