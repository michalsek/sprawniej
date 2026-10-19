# Sprawniej

Plan and track your team's work: issues, projects and views, on a list or a board.

**Open it: [michalsek.github.io/sprawniej](https://michalsek.github.io/sprawniej/)**

![A team's issues on the board in Sprawniej](docs/images/board.png)

- **Issues** with statuses and priorities, rich descriptions, sub-issues and comments
- **List and board**, with drag-n-drop in both
- **Teams**, each with its own issues, projects and views
- **Views** with emojis: saved filters anyone on the team can open
- **Inbox** for assignments, mentions and comments
- **Import from Linear**
- **Saves by itself.** No Save button.
- **Teammates' changes show up as they happen.**
- **Sign in with email and password, or GitHub.** Invite people with a link; owners, admins and members.

## For teammates

Open the invite link you were sent. The [user guide](docs/user-guide.md) explains the rest (it is also the Help page
in the app).

## For developers

Sprawniej is a static web app on GitHub Pages and one Supabase project. No Docker and no local Supabase are needed:
development uses a hosted project ([docs/supabase-setup.md](docs/supabase-setup.md)).

```sh
bun install
# .env.local (not saved in git), from docs/supabase-setup.md:
#   VITE_SUPABASE_URL=https://<ref>.supabase.co
#   VITE_SUPABASE_KEY=sb_publishable_...
bun dev            # http://localhost:5173
bun test           # logic tests, never touch a database
bun run test:db    # database tests: a development or throwaway project only
bun run build      # dist/
```

Publishing is by hand: push `main`, then run the *Deploy to GitHub Pages* workflow
(`gh workflow run pages.yml -R michalsek/sprawniej`). The build reads the repository variables `VITE_SUPABASE_URL`,
`VITE_SUPABASE_KEY` and `VITE_PUBLIC_URL` (the address invite links use).

Start with [CLAUDE.md](CLAUDE.md) (working rules) and [docs/architecture.md](docs/architecture.md).
