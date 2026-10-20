-- GitHub: a pull request delivered late (GitHub doesn't promise the order) no longer puts itself back on an issue a
-- newer delivery took it off. github_apply is as in 20261020140000_issue_pull_requests.sql, except that a pull
-- request is added to an issue only when no issue in the workspace has a newer state of it.

create or replace function public.github_apply(p_connection uuid, p_repository_id bigint, p_repo text, p_actor uuid,
                                    p_via jsonb, p_moves jsonb, p_notes jsonb, p_event jsonb,
                                    p_pull jsonb default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.github_repos;
  moved text[] := '{}';
  moved_refs text[] := '{}';
  mv jsonb;
  done text;
  pr_at timestamptz;
  pr_issues text[];
begin
  select * into c from public.github_repos where id = p_connection for update;
  if not found then raise exception 'There is no such connection.' using errcode = 'P0002'; end if;

  if p_actor is not null then
    if not exists (select 1 from public.workspace_members m
                    where m.workspace_id = c.workspace_id and m.profile_id = p_actor and m.removed_at is null) then
      raise exception 'That person isn''t in this workspace.' using errcode = '42501';
    end if;
    perform set_config('sprawniej.actor', p_actor::text, true);
    perform set_config('sprawniej.via', coalesce(p_via, 'null')::text, true);
    for mv in select * from jsonb_array_elements(coalesce(p_moves, '[]')) loop
      update public.issues set status = mv ->> 'to'
       where id = mv ->> 'issue' and workspace_id = c.workspace_id and archived_at is null
         and status in (select jsonb_array_elements_text(mv -> 'from'))
      returning id into done;
      if done is not null then
        moved := moved || done;
        moved_refs := moved_refs || (mv ->> 'ref');
        done := null;
      end if;
    end loop;
    insert into public.inbox (id, workspace_id, recipient_id, type, issue_id, status)
    select n ->> 'id', c.workspace_id, (n ->> 'to')::uuid, 'status', n ->> 'issue', n ->> 'status'
      from jsonb_array_elements(coalesce(p_notes, '[]')) n
     where n ->> 'issue' = any(moved);
    perform set_config('sprawniej.via', '', true);
    perform set_config('sprawniej.actor', '', true);

    if p_pull is not null then
      pr_at := coalesce((p_pull ->> 'updated_at')::timestamptz, now());
      pr_issues := array(select jsonb_array_elements_text(coalesce(p_pull -> 'issues', '[]')));
      insert into public.issue_pull_requests as r
        (workspace_id, issue_id, pull_request_id, repo, number, title, url, state, author_id, github_updated_at)
      select c.workspace_id, i.id, p_pull ->> 'id', p_pull ->> 'repo', (p_pull ->> 'number')::integer,
             left(coalesce(p_pull ->> 'title', ''), 300), p_pull ->> 'url', p_pull ->> 'state', p_actor, pr_at
        from public.issues i
       where i.workspace_id = c.workspace_id and i.archived_at is null and i.id = any(pr_issues)
         and not exists (select 1 from public.issue_pull_requests o
                          where o.workspace_id = c.workspace_id and o.pull_request_id = p_pull ->> 'id'
                            and o.github_updated_at > pr_at)
      on conflict (issue_id, pull_request_id) do update set
        repo = excluded.repo, number = excluded.number, title = excluded.title, url = excluded.url,
        state = excluded.state, author_id = excluded.author_id, github_updated_at = excluded.github_updated_at
      where r.github_updated_at <= excluded.github_updated_at;
      -- a ref taken out of the title: that issue no longer shows it (archived issues keep theirs)
      delete from public.issue_pull_requests r
       where r.workspace_id = c.workspace_id and r.pull_request_id = p_pull ->> 'id'
         and r.github_updated_at <= pr_at and r.issue_id <> all(pr_issues)
         and exists (select 1 from public.issues i where i.id = r.issue_id and i.archived_at is null);
    end if;
  end if;

  update public.github_repos set
    repository_id = coalesce(p_repository_id, repository_id),
    repo = case when p_repo is not null and not exists (
                  select 1 from public.github_repos o
                   where o.workspace_id = c.workspace_id and o.id <> c.id and lower(o.repo) = lower(p_repo))
                then p_repo else repo end,
    last_event_at = case when p_event is null then last_event_at else now() end,
    last_event = case when p_event is null then last_event
                      else p_event || jsonb_build_object('moved', to_jsonb(moved_refs)) end
   where id = c.id;
  return jsonb_build_object('moved', to_jsonb(moved_refs));
end $$;
