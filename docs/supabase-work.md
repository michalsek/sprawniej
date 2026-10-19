# Supabase migration: work log

Tracks the implementation of [supabase-plan.md](supabase-plan.md). There is no ticket system for this work, so this
file is the ticket: roadmap, status, findings and questions. Every finding ends as **fixed** or **canceled / won't do**
with a reason.

## Decisions made while building

- 2026-10-19: **No Docker, no local stack.** Development and tests run against `sprawniejapp` itself; it only holds a
  copy of Linear tasks that can be imported again. Database tests are bun tests that talk to the project through its
  API with throwaway test accounts (they never run in plain `bun test`). The runbook for a new project needs no Docker
  either (`supabase db push`, `supabase config push`).
- 2026-10-19: Work happens in the session's worktree; `main` is fast-forwarded to it after each step (the session
  can't write in the main checkout directly).

## Roadmap

Status: `todo`, `doing`, `done`.

| # | Phase | Status | Notes |
| --- | --- | --- | --- |
| 0 | Plan merged into `main`, Supabase CLI as a dev dependency | done | |

## Findings

Anything wrong or worth improving that turned up along the way, in this work or in the existing code.

| # | Found by | What | Status | Reason / where fixed |
| --- | --- | --- | --- | --- |

## Waiting on the user

| What | Status |
| --- | --- |
| GitHub OAuth app for sign-in (homepage `https://michalsek.github.io/sprawniej/`, callback `https://wkqofiacqfuxowavuqxj.supabase.co/auth/v1/callback`); id and secret stay in the user's shell | asked 2026-10-19 |
| `bunx supabase login` once, so the CLI can push the schema and auth settings | asked 2026-10-19 |
