-- Pictures: a private bucket. Files are named <workspace id>/<sha>.<ext>; the first folder decides who may see them.
-- The folder is compared as text, so a name that isn't a workspace id is simply refused (P8).
-- No update or delete policy: a picture never changes (its name is its hash). Upload with upsert off and treat
-- "already there" (409) as done.

-- "do nothing": the bucket outlives a wipe of the database (storage can't be emptied with SQL), so re-applying must
-- not fail (P21)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pictures', 'pictures', false, 10485760, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

create policy "sprawniej: members see pictures" on storage.objects for select to authenticated
  using (bucket_id = 'pictures'
         and (storage.foldername(name))[1] in (select w.id::text from private.my_workspaces() as w(id)));

create policy "sprawniej: members add pictures" on storage.objects for insert to authenticated
  with check (bucket_id = 'pictures'
              and (storage.foldername(name))[1] in (select w.id::text from private.my_workspaces() as w(id)));
