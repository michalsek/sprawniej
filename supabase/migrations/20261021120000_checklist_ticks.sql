-- Checklist ticks: ticking an item in an issue's description changes only that item's box, in the database, so two
-- people ticking different items at the same moment both keep their tick (saving the whole text would undo the
-- other's). Only a new function; no table changes.
--
-- Items are found exactly as the app finds them (src/data/checklist.ts, keep the two in step): a line like
-- "- [ ] text", "* [x] text" or "> + [X] text", never inside a code block (``` or ~~~). tests/fixtures/checklists.ts
-- runs the same cases against both.

-- Ticks (p_checked) or unticks item number p_item (from 0) of an issue's description. The item is the one at that
-- place if it still says p_text, else the only item that says it; when neither is there it changed meanwhile, and
-- nothing is saved. Already that way: the issue comes back unchanged (no update, no history line). Returns the issue
-- as it is now. Security invoker: the usual rules decide who may change the issue.
create function public.set_checklist_item(p_issue text, p_item integer, p_text text, p_checked boolean)
returns public.issues
language plpgsql security invoker set search_path = '' as $$
declare
  i public.issues;
  lines text[];
  line text;
  m text[];
  f text[];
  fence text;
  item_text text;
  n integer := 0;
  k integer;
  at_line integer;
  at_box integer;
  same_lines integer[] := '{}';
  same_boxes integer[] := '{}';
begin
  select * into i from public.issues where id = p_issue for update;
  if not found then raise exception 'There is no such issue.' using errcode = 'P0002'; end if;

  lines := string_to_array(i.description, E'\n');
  for k in 1 .. coalesce(array_length(lines, 1), 0) loop
    line := lines[k];
    if fence is not null then
      f := regexp_match(line, '^ {0,3}(`{3,}|~{3,})[ \t]*$');
      if f is not null and left(f[1], 1) = left(fence, 1) and length(f[1]) >= length(fence) then fence := null; end if;
      continue;
    end if;
    f := regexp_match(line, '^ {0,3}(`{3,}|~{3,})');
    if f is not null then
      fence := f[1];
      continue;
    end if;
    m := regexp_match(line, '^((?:[ \t]*>)*[ \t]*[-+*][ \t]+\[)([ xX])\](?:[ \t]+([^\n]*))?$');
    if m is null then continue; end if;
    item_text := rtrim(coalesce(m[3], ''), E' \t\r');
    if item_text = p_text then
      if n = p_item then
        at_line := k;
        at_box := length(m[1]) + 1;
      end if;
      same_lines := same_lines || k;
      same_boxes := same_boxes || (length(m[1]) + 1);
    end if;
    n := n + 1;
  end loop;

  if at_line is null and cardinality(same_lines) = 1 then
    at_line := same_lines[1];
    at_box := same_boxes[1];
  end if;
  if at_line is null then
    raise exception 'That checklist item changed meanwhile, so your tick wasn''t saved. Have a look and tick it again.'
      using errcode = 'P0001';
  end if;

  if (substr(lines[at_line], at_box, 1) <> ' ') = p_checked then return i; end if;
  lines[at_line] := overlay(lines[at_line] placing (case when p_checked then 'x' else ' ' end) from at_box for 1);
  update public.issues set description = array_to_string(lines, E'\n') where id = p_issue
  returning * into i;
  return i;
end $$;

grant execute on function public.set_checklist_item(text, integer, text, boolean) to authenticated;
