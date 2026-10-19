-- Realtime: every change to a shared row is broadcast from the database (docs/supabase-plan.md, section 5).
-- Two private channels per open workspace: ws:<workspace id> for the shared rows, me:<profile id> for your inbox and
-- read marks.
--
-- Access is checked once, when a browser joins a channel. Someone removed from a workspace keeps receiving its
-- changes until they rejoin (reload, reconnect). That is fine for a team of eight (P23).

-- Arguments: the topic prefix, the column that completes the topic (empty for profiles), then the key columns.
-- An update sends only what changed, plus the keys and changed_at; a delete sends the keys.
create function private.broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  prev jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  payload jsonb;
  msg jsonb;
  ws uuid;
begin
  if private.importing() then return null; end if;   -- imports send one catch-up message instead (P15)
  if tg_op = 'DELETE' and tg_argv[0] = 'ws:' and tg_table_name not in ('workspaces', 'profiles')
     and not exists (select 1 from public.workspaces w where w.id = (rec ->> tg_argv[1])::uuid) then
    return null;                                      -- the whole workspace is going; its own message says so
  end if;
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(e.key, e.value) into payload
      from jsonb_each(rec) e
     where e.key <> all (array['changed_at', 'last_number']) and prev -> e.key is distinct from e.value;
    if payload is null then return null; end if;      -- nothing people see changed (a team's counter, say)
    select payload || jsonb_object_agg(k, rec -> k) into payload from unnest(tg_argv[2:] || array['changed_at']) k;
  elsif tg_op = 'DELETE' then
    select jsonb_object_agg(k, rec -> k) into payload from unnest(tg_argv[2:]) k;
  else
    payload := rec;
  end if;
  if octet_length(payload::text) > 200000 then        -- a huge description: a nudge, the app fetches the row
    payload := (payload - 'description' - 'body') || '{"partial": true}';
  end if;
  msg := jsonb_build_object('table', tg_table_name, 'op', tg_op, 'row', payload);
  if tg_table_name = 'profiles' then                  -- every workspace the person is (or was) in, or the guest's
    for ws in
      select m.workspace_id from public.workspace_members m where m.profile_id = (rec ->> 'id')::uuid
      union
      select (rec ->> 'guest_of')::uuid where rec ->> 'guest_of' is not null
    loop
      perform realtime.send(msg, 'change', 'ws:' || ws, true);
    end loop;
    return null;
  end if;
  perform realtime.send(msg, 'change', tg_argv[0] || (rec ->> tg_argv[1]), true);
  return null;
end $$;

-- The "live" trigger that calls it on every broadcast table is made by private.wire() (20261019000005_rls.sql).
-- invites, history, used numbers and deletions are not broadcast (P9).

-- Who may listen. The topic is compared as text, so a topic that isn't a workspace id is simply refused (P8).
-- There is no insert policy: browsers can't send on these channels.
create policy "sprawniej: members listen" on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast' and (
    (left((select realtime.topic()), 3) = 'ws:'
     and substr((select realtime.topic()), 4) in (select w.id::text from private.my_workspaces() as w(id)))
    or (select realtime.topic()) = 'me:' || (select private.my_profile_id())::text
  )
);
