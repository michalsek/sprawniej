-- Removes what the database tests (bun run test:db) left behind: their workspaces, profiles and sign-in accounts.
-- Only for a development or throwaway project. Run it with
--   bunx supabase db query --linked -f supabase/dev/cleanup-tests.sql
-- (or paste it into the SQL editor).
-- Their pictures stay in the "pictures" bucket; they are tiny, delete them in Storage if you like.

-- the test workspaces, with everything in them (their people from Linear too)
delete from public.workspaces where name like 'dbtest %';
-- the test accounts' profiles, then the accounts
delete from public.profiles p using auth.users u where p.user_id = u.id and u.email like 'dbtest-%';
delete from auth.users where email like 'dbtest-%';
-- notes about rows of workspaces that are gone (the nightly job would forget them after 45 days)
delete from public.deletions d where not exists (select 1 from public.workspaces w where w.id = d.workspace_id);
