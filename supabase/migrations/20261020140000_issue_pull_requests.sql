-- GitHub: the pull requests that mention an issue, shown on the issue page as they change (docs/github-app.md).
--
-- The Edge Function github-webhook already reads every pull request event of a connected repository. Now it also
-- tells github_apply which issues the pull request mentions and how it stands (open, draft, merged, closed), and
-- github_apply keeps one row per issue and pull request. Nobody signed in writes them: members only read them, live,
-- on ws:<workspace>. As with moving issues, a pull request is kept only when its author is a member of the workspace
-- with GitHub, so a workspace that connects someone else's repository learns nothing from it.

-- ---------- the pull requests that mention an issue ----------

create table public.issue_pull_requests (
  workspace_id       uuid not null,
  issue_id           text not null,
  pull_request_id    text not null check (pull_request_id ~ '^\d{1,20}$'),   -- GitHub's number for the pull request
  repo               text not null check (repo ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}$'),
  number             integer not null check (number > 0),
  title              text not null default '' check (length(title) <= 300),
  url                text not null check (url ~ '^https://'),
  state              text not null check (state in ('open', 'draft', 'merged', 'closed')),
  author_id          uuid references public.profiles (id) on delete set null,
  github_updated_at  timestamptz not null,        -- GitHub's time for this state: an older delivery never wins
  created_at         timestamptz not null default now(),
  changed_at         timestamptz not null default clock_timestamp(),
  primary key (issue_id, pull_request_id),
  foreign key (workspace_id, issue_id) references public.issues (workspace_id, id) on delete cascade
);
create index issue_pull_requests_changed on public.issue_pull_requests (workspace_id, changed_at);
create index issue_pull_requests_issue on public.issue_pull_requests (workspace_id, issue_id);
create index issue_pull_requests_pull on public.issue_pull_requests (workspace_id, pull_request_id);
create index issue_pull_requests_author on public.issue_pull_requests (author_id);

insert into private.wiring (name, keys, ws_col, topic, topic_col, policies, stamp, forget) values
  ('issue_pull_requests', '{issue_id,pull_request_id}', 'workspace_id', 'ws:', 'workspace_id', null,          'touch',         true);
call private.wire('issue_pull_requests');

-- members read them; only github_apply writes them, so there is no other policy and no write grant
create policy "members read pull requests" on public.issue_pull_requests for select to authenticated
  using (workspace_id in (select private.my_workspaces()));

-- ---------- github_apply also keeps them ----------

-- As in the GitHub file, plus p_pull: the pull request as it stands now,
--   {"id", "repo", "number", "title", "url", "state", "updated_at", "issues": [issue ids it mentions]}
-- kept for each of those issues (when the author is a member), and taken off issues it no longer mentions. Without
-- p_event (a pull request event that moves nothing: a draft, an edit, closing without merging) the connection keeps
-- its last_event, so Settings goes on showing the last move.
drop function public.github_apply(uuid, bigint, text, uuid, jsonb, jsonb, jsonb, jsonb);

create function public.github_apply(p_connection uuid, p_repository_id bigint, p_repo text, p_actor uuid,
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

grant execute on function public.github_apply(uuid, bigint, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
