/**
 * Shared pieces for the database tests in tests/db. They talk to a real Supabase project through its API, as
 * throwaway accounts, so they only run with SPRAWNIEJ_DB_TESTS set (`bun run test:db`). Plain `bun test` imports
 * these files and skips them: nothing here may connect or throw at import time.
 *
 * The project comes from VITE_SUPABASE_URL and VITE_SUPABASE_KEY (the environment, or .env.local).
 * Test accounts are dbtest-<run>-<name>@<domain> and workspaces 'dbtest <run> …'. When the run ends, tests/db/preload.ts
 * removes them (tests/db/cleanup.ts), and only them: other runs going at the same time are left alone. Set
 * SPRAWNIEJ_TEST_RUN to name the run yourself (letters and digits), and SPRAWNIEJ_TEST_KEEP to keep what it made for a
 * look (then `bun run test:db:clean <run>`). Only for a development or throwaway project.
 *
 * New accounts need a sign-up code. The run makes its own (note "dbtest <run>") through the Supabase CLI, which must be
 * linked to the same project (`bunx supabase link`): codes can only be made in the SQL editor or with the CLI.
 */
import { expect } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { ulid as makeUlid } from 'ulid'
import type { Database } from '@/backend/database.types'

export const enabled = !!process.env.SPRAWNIEJ_DB_TESTS

/** one run of the tests: every account, login and workspace name carries it (SPRAWNIEJ_TEST_RUN picks it) */
export const RUN = process.env.SPRAWNIEJ_TEST_RUN ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 4)
/** a run's name: letters and digits, so cleaning up run "ab" never touches run "abc" (dbtest-ab-… and dbtest-abc-…) */
export const RUN_NAME = /^[A-Za-z0-9]+$/
if (enabled && !RUN_NAME.test(RUN)) throw new Error(`SPRAWNIEJ_TEST_RUN is letters and digits only, not "${RUN}".`)

/** Auth refuses example and test domains, so the default is a real (throwaway) mail domain. */
const DOMAIN = process.env.SPRAWNIEJ_TEST_EMAIL_DOMAIN ?? 'mailinator.com'

export type Db = SupabaseClient<Database>

/** the email of a test account */
export const testEmail = (name: string) => `dbtest-${RUN}-${name}@${DOMAIN}`
type Tables = Database['public']['Tables']
export type TableName = keyof Tables
export type Row<T extends TableName> = Tables[T]['Row']

function env() {
  if (!process.env.VITE_SUPABASE_URL) {
    const file = join(import.meta.dir, '..', '..', '.env.local')
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
      }
    }
  }
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_KEY
  if (!url || !key) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY (or write them in .env.local).')
  return { url, key }
}

const clients: Db[] = []

export function client(): Db {
  const { url, key } = env()
  const c = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  clients.push(c)
  return c
}

/**
 * The same client without table types, for the few tests that loop over every table by name (a union of 20 tables
 * has no single row type to check against).
 */
export const anyTable = (db: Db, table: TableName) => (db as SupabaseClient).from(table)

interface Person {
  name: string
  db: Db
  userId: string
  profileId: string
  login: string
}

/** someone who never signed in */
export const anonClient = client

/**
 * Runs SQL as the project's owner through the Supabase CLI (`db query --linked`), for what browsers can't do: making
 * sign-up codes, reading private tables. Returns the rows.
 */
export function ownerSql<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  sqlUsed = true
  // one at a time: two CLI calls at once trip over each other
  const next = cliQueue.then(() => runSql<T>(sql))
  cliQueue = next.catch(() => undefined)
  return next
}

let cliQueue: Promise<unknown> = Promise.resolve()
let sqlUsed = false

/** whether this run made anything (every account needs a sign-up code, and those are made here), for the cleanup */
export const madeAnything = () => sqlUsed

/** the CLI must be linked to the project the tests use; the project's ref */
function checkLinked(): string {
  const { url } = env()
  const refFile = join(import.meta.dir, '..', '..', 'supabase', '.temp', 'project-ref')
  const linked = existsSync(refFile) ? readFileSync(refFile, 'utf8').trim() : ''
  if (!linked || !url.startsWith(`https://${linked}.`)) {
    throw new Error(`The Supabase CLI must be linked to the project in .env.local (${url}): bunx supabase link --project-ref <ref>`)
  }
  return linked
}

/**
 * One CLI call at a time on this computer, also across test runs going at once (other worktrees, a cleanup): every
 * call makes a new temporary database login, and two at once lock each other out for minutes and then fail.
 */
async function withCliLock<T>(ref: string, run: () => Promise<T>): Promise<T> {
  const dir = join(tmpdir(), `sprawniej-supabase-cli-${ref}.lock`)
  for (;;) {
    try {
      mkdirSync(dir)
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    if (lockLeftBehind(dir)) rmSync(dir, { recursive: true, force: true })
    else await Bun.sleep(100 + Math.random() * 200)
  }
  writeFileSync(join(dir, 'owner'), String(process.pid))
  try {
    return await run()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** a lock whose process is gone (stopped halfway), or that is far older than any call */
function lockLeftBehind(dir: string): boolean {
  try {
    const age = Date.now() - statSync(dir).mtimeMs
    const pid = Number(existsSync(join(dir, 'owner')) ? readFileSync(join(dir, 'owner'), 'utf8') : 0)
    // no owner written yet: it is being taken right now
    if (!pid) return age > 10_000
    try {
      process.kill(pid, 0)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') return true
    }
    return age > 5 * 60_000
  } catch {
    return false   // let go meanwhile
  }
}

/** far longer than a call takes (about 2 s); one that takes longer is stopped and tried again */
const CLI_TIME_LIMIT = 20_000

/**
 * The CLI's login was refused. Every call gives the CLI's one login (cli_login_postgres) a new password, and now and
 * then Supabase's connection pooler still has the one before: the CLI then tries the stale password again for minutes.
 * Nothing has run yet, so the call is stopped at once and made again, with a new password.
 */
const STALE_LOGIN = /password authentication failed for user "cli_login_/

/** what the CLI said, without its --debug lines (requests and retries) */
const said = (err: string) =>
  err
    .split('\n')
    .filter((l) => l.trim() && !/^(\d{4}\/\d\d\/\d\d |Using |Supabase CLI |NotFound: |Retry \()/.test(l))
    .join('\n')

/**
 * Runs the Supabase CLI. A refused login (STALE_LOGIN), a call that hangs, and Supabase's API answering 500 or 544
 * (it timed out) before or without running anything are tried again, a few times. A refused query (400) is not.
 */
async function cli(args: string[], what: string): Promise<string> {
  const ref = checkLinked()
  for (let attempt = 1; ; attempt++) {
    const { out, err, code, hung, stale } = await withCliLock(ref, async () => {
      const started = Date.now()
      // --debug: the CLI says when its login is refused, which it otherwise keeps to itself while it tries again
      const proc = Bun.spawn(['bunx', 'supabase', '--debug', ...args], { stdout: 'pipe', stderr: 'pipe', timeout: CLI_TIME_LIMIT })
      let err = ''
      let stale = false
      const reading = (async () => {
        const text = new TextDecoder()
        for await (const chunk of proc.stderr) {
          err += text.decode(chunk, { stream: true })
          if (!stale && STALE_LOGIN.test(err)) {
            stale = true
            proc.kill()
          }
        }
      })()
      const [out, , code] = await Promise.all([new Response(proc.stdout).text(), reading, proc.exited])
      // stopped: the CLI passes the signal on and ends with an exit code of its own
      return { out, err, code, stale, hung: Date.now() - started >= CLI_TIME_LIMIT }
    })
    if (code === 0 && !stale) return out
    const flaky = stale || hung || /unexpected status 5\d\d|connection reset by peer|i\/o timeout|TLS handshake timeout|unexpected EOF/i.test(err + out)
    if (!flaky || attempt === 5) throw new Error(`${what} failed${stale ? ' (login refused)' : hung ? ' (no answer in time)' : ''}: ${said(err)}\n${out}`)
    if (process.env.SPRAWNIEJ_DB_DEBUG) console.log(`CLI ${stale ? 'login refused' : hung ? 'no answer' : 'error'}, trying again (${attempt})`)
    await Bun.sleep(stale ? 200 : 1000 * attempt)
  }
}

async function runSql<T>(sql: string): Promise<T[]> {
  const out = await cli(['db', 'query', '--linked', '--output-format', 'json', sql], `SQL ${sql}`)
  const start = out.indexOf('{')
  if (start < 0) throw new Error(`SQL gave no answer: ${sql}\n${out}`)
  return (JSON.parse(out.slice(start)) as { rows?: T[] }).rows ?? []
}

/** removes pictures from the bucket by path (through the Storage API: the database can't delete files) */
export function storageRm(paths: string[]): Promise<unknown> {
  const next = cliQueue.then(() => cli(['storage', 'rm', '--linked', '--experimental', '--yes', ...paths.map((p) => `ss:///pictures/${p}`)], 'Removing pictures'))
  cliQueue = next.catch(() => undefined)
  return next
}

/** a new sign-up code (shown as XXXX-XXXX-XXXX), noted as this run's */
export async function newSignupCode(label: string, days = 1, uses = 1): Promise<string> {
  // in a transaction of its own: a lone select through the CLI is rolled back, and the code with it
  const [row] = await ownerSql<{ code: string }>(`begin; select private.make_signup_code('dbtest ${RUN} ${label}', ${days}, ${uses}) as code; commit;`)
  return row.code
}

let runCode: Promise<string> | undefined

/** what lets a test account in: by default one code for the whole run */
export type Permit = { signup_code?: string; invite?: string }

/** a new account without a profile yet (it still has to pick its name) */
export async function signUpBare(name: string, permit?: Permit): Promise<{ db: Db; userId: string }> {
  const db = client()
  const { data, error } = await db.auth.signUp({
    email: testEmail(name),
    password: `${crypto.randomUUID()}Aa1!`,
    options: { data: permit ?? { signup_code: await (runCode ??= newSignupCode('run', 1, 100)) } },
  })
  if (error) {
    throw new Error(
      `Sign-up failed (${error.code ?? error.status}: ${error.message}). If the email domain is refused, set ` +
        'SPRAWNIEJ_TEST_EMAIL_DOMAIN to another real domain.',
    )
  }
  if (!data.session || !data.user) {
    throw new Error(
      'Email confirmations are on. Run `bunx supabase config push --project-ref <ref>` (or turn off Confirm email ' +
        'in the dashboard, Authentication, Email).',
    )
  }
  // join channels as this person, not as someone signed out
  await db.realtime.setAuth(data.session.access_token)
  return { db, userId: data.user.id }
}

/** a new account with a profile (login dbt-<run>-<name>) */
export async function signUp(name: string): Promise<Person> {
  const { db, userId } = await signUpBare(name)
  const login = `dbt-${RUN}-${name}`
  const profile = await ok(db.rpc('create_profile', { p_login: login, p_name: `Test ${name}` }).single())
  return { name, db, userId, profileId: profile.id, login }
}

export interface World {
  ana: Person // owner of ws
  bob: Person // member of ws (joined through an invite)
  cy: Person // in no workspace of ana's
  dee: Person // spare: tests that change membership add dee to their own workspace
  ws: string
  eng: string // the first team
  des: string
  guest: string // a person from Linear in ws
  guestLogin: string
}
export type Someone = World['ana']

let world: Promise<World> | undefined

/** One shared world per `bun test` run, so a run signs up only four accounts. */
export function getWorld(): Promise<World> {
  world ??= makeWorld()
  return world
}

async function makeWorld(): Promise<World> {
  const [ana, bob, cy, dee] = await Promise.all(['ana', 'bob', 'cy', 'dee'].map(signUp))
  const { ws, team: eng } = await newWorkspace(ana, 'main')
  const des = await newTeam(ana, ws, 'DES')
  await addMember(ana, bob, ws)
  const guest = crypto.randomUUID()
  const guestLogin = `~dbt-${RUN}-g1`
  await ok(ana.db.rpc('import_rows', { p_ws: ws, p_table: 'profiles', p_rows: [{ id: guest, login: guestLogin, name: 'Guest One' }] }))
  return { ana, bob, cy, dee, ws, eng, des, guest, guestLogin }
}

/** a workspace owned by `owner`, and its first team (ENG) */
export async function newWorkspace(owner: Someone, label: string): Promise<{ ws: string; team: string }> {
  const ws = await ok(
    owner.db.rpc('create_workspace', { p_name: `dbtest ${RUN} ${label}`, p_team_key: 'ENG', p_team_name: 'Engineering', p_team_emoji: '' }),
  )
  const team = await ok(owner.db.from('teams').select('id').eq('workspace_id', ws).eq('key', 'ENG').single())
  return { ws, team: team.id }
}

export async function newTeam(who: Someone, ws: string, key: string): Promise<string> {
  const id = crypto.randomUUID()
  await ok(who.db.from('teams').insert({ id, workspace_id: ws, key, name: key }))
  return id
}

/** `admin` invites `person` (as `role`), and they accept */
export async function addMember(admin: Someone, person: Someone, ws: string, role: 'member' | 'admin' = 'member') {
  const inv = await ok(admin.db.from('invites').insert({ workspace_id: ws, role }).select('token').single())
  await ok(person.db.rpc('accept_invite', { p_token: inv.token }))
}

export const ulid = () => makeUlid()

type IssueInsert = Database['public']['Tables']['issues']['Insert']
/** an issue as an older version sends it: without status_id, which the database fills in (the category's default) */
type IssueWithout = Omit<IssueInsert, 'status_id'> & Partial<Pick<IssueInsert, 'status_id'>>
/** the generated types say status_id is needed (it is never null); the database fills it in when it's left out */
export const issueInsert = (row: IssueWithout): IssueInsert => row as IssueInsert

type ProjectInsert = Database['public']['Tables']['projects']['Insert']
/** a project as an older version sends it: without status_id, which the database fills in (as issueInsert) */
export const projectInsert = (row: Omit<ProjectInsert, 'status_id'> & Partial<Pick<ProjectInsert, 'status_id'>>): ProjectInsert => row as ProjectInsert

let order = 0
/** a new issue in a team; returns the row */
export async function newIssue(who: Someone, ws: string, team: string, more: Partial<IssueInsert> = {}) {
  return ok(
    who.db
      .from('issues')
      .insert(issueInsert({ id: ulid(), workspace_id: ws, team_id: team, title: 'Test issue', sort_order: `a${order++}`, ...more }))
      .select()
      .single(),
  )
}

/** a workspace's issue (or project) statuses by category: the default (first shown) one of each, as every workspace starts */
export async function defaultStatuses(who: Someone, ws: string, kind: 'issue' | 'project' = 'issue'): Promise<Record<string, string>> {
  const rows = await ok(who.db.from('statuses').select('id, category, position, hidden').eq('workspace_id', ws).eq('kind', kind).eq('hidden', false).order('position').order('id'))
  const out: Record<string, string> = {}
  for (const r of rows) out[r.category] ??= r.id
  return out
}

type Result<T> = PromiseLike<{ data: T; error: { message: string; code?: string } | null }>

/** the data of a Supabase call, or a thrown error with its code. Writes without .select() give null; ignore it. */
export async function ok<T>(call: Result<T>): Promise<NonNullable<T>> {
  const { data, error } = await call
  if (error) throw new Error(`${error.code ?? ''} ${error.message}`)
  return data as NonNullable<T>
}

/** the call failed with a permission error */
export async function expectDenied(call: Result<unknown>) {
  const { error } = await call
  expect(error?.code).toBe('42501')
}

/** the call failed (with `code`, when given) */
export async function expectError(call: Result<unknown>, code?: string) {
  const { error } = await call
  expect(error).not.toBeNull()
  if (code) expect(error?.code).toBe(code)
}

/** what arrives on a channel (private.broadcast) */
export interface Change {
  table?: string
  op?: string
  row?: Record<string, unknown>
}

export interface Listener {
  channel: RealtimeChannel
  status: string
  got: Change[]
  /**
   * waits for a message matching `pred`, or returns undefined after `ms`. It returns as soon as one comes, so the
   * default is generous: messages take longer while other runs keep the project busy. To check that nothing comes, pass
   * a short `ms`.
   */
  waitFor: (pred: (m: Change) => boolean, ms?: number) => Promise<Change | undefined>
}

/** joins a private channel and collects its "change" messages */
export async function listen(who: Someone, topic: string): Promise<Listener> {
  const got: Change[] = []
  // a client keeps one channel per topic; start over so a test hears only its own messages
  for (const c of who.db.getChannels()) if (c.topic === `realtime:${topic}`) await who.db.removeChannel(c)
  const channel = who.db.channel(topic, { config: { private: true } })
  channel.on('broadcast', { event: 'change' }, (m) => got.push(m.payload as Change))
  const status = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve('TIMED_OUT'), 6000)
    channel.subscribe((s, err) => {
      if (err && process.env.SPRAWNIEJ_DB_DEBUG) console.log(topic, s, err.message)
      if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
        clearTimeout(timer)
        resolve(s)
      }
    })
  })
  const waitFor = async (pred: (m: Change) => boolean, ms = 10_000) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      const m = got.find(pred)
      if (m) return m
      await Bun.sleep(50)
    }
    return got.find(pred)
  }
  return { channel, status, got, waitFor }
}

/** for afterAll: leave every channel, so Bun can exit */
export async function closeChannels() {
  await Promise.all(clients.map((c) => c.removeAllChannels()))
}

/** every table, as in private.wiring (tests/wiringList.test.ts checks) */
export const TABLES = [
  'workspaces',
  'profiles',
  'workspace_members',
  'invites',
  'invite_uses',
  'teams',
  'team_members',
  'labels',
  'statuses',
  'projects',
  'project_teams',
  'issues',
  'issue_labels',
  'issue_followers',
  'comments',
  'views',
  'inbox',
  'read_state',
  'issue_events',
  'issue_numbers',
  'deletions',
  'github_repos',
  'issue_pull_requests',
  'notion_connections',
  'favourites',
] as const satisfies readonly TableName[]

/** the column that says which workspace a row belongs to */
export const wsColumn = (t: TableName) => (t === 'workspaces' ? 'id' : t === 'profiles' ? 'guest_of' : 'workspace_id')

export const DISPLAY = { layout: 'list', grouping: 'status', ordering: 'manual', showCompleted: true, showSubIssues: true }

/** SQL as the service role (what an Edge Function is): for the functions only Edge Functions may call */
export const asService = <T = Record<string, unknown>>(query: string) =>
  ownerSql<T>(`begin; set local role service_role; ${query}; commit;`)

/** a quoted SQL literal */
export const lit = (v: unknown) => `'${(typeof v === 'string' ? v : JSON.stringify(v)).replaceAll("'", "''")}'`
