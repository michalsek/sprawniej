-- Removes what the database tests (bun run test:db) left behind: their workspaces, profiles and sign-in accounts.
-- Run it on a development project: bunx supabase db query --linked -f supabase/dev/cleanup-tests.sql
-- (or paste it into the SQL editor).
-- Their pictures stay in the "pictures" bucket; they are tiny, delete them in Storage if you like.

delete from public.workspaces where name like 'dbtest %';
delete from public.profiles where login like 'dbt-%' or login like '~dbt-%';
delete from auth.users where email like 'dbtest-%';
-- notes about rows of workspaces that are gone (the nightly job would forget them after 45 days)
delete from public.deletions d where not exists (select 1 from public.workspaces w where w.id = d.workspace_id);
