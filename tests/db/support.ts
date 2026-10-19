/**
 * Shared pieces for the database tests in tests/db. They talk to a real Supabase project through its API, as
 * throwaway accounts, so they only run with SPRAWNIEJ_DB_TESTS set (`bun run test:db`). Plain `bun test` imports
 * these files and skips them: nothing here may connect or throw at import time.
 *
 * The project comes from VITE_SUPABASE_URL and VITE_SUPABASE_KEY (the environment, or .env.local).
 * Test accounts are dbtest-<run>-<name>@<domain>; supabase/dev/cleanup-tests.sql removes them afterwards.
 * Only for a development or throwaway project.
 */
import { expect } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { ulid as makeUlid } from 'ulid'
import type { Database } from '@/backend/database.types'

export const enabled = !!process.env.SPRAWNIEJ_DB_TESTS

/** one run of the tests: every account, login and workspace name carries it (SPRAWNIEJ_TEST_RUN picks it, to clean up after) */
export const RUN = process.env.SPRAWNIEJ_TEST_RUN ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 4)

/** Auth refuses example and test domains, so the default is a real (throwaway) mail domain. */
const DOMAIN = process.env.SPRAWNIEJ_TEST_EMAIL_DOMAIN ?? 'mailinator.com'

export type Db = SupabaseClient<Database>
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
 * The same client without table types, for the few tests that loop over every table by name (a union of 19 tables
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

/** a new account without a profile yet (it still has to pick its name) */
export async function signUpBare(name: string): Promise<{ db: Db; userId: string }> {
  const db = client()
  const { data, error } = await db.auth.signUp({
    email: `dbtest-${RUN}-${name}@${DOMAIN}`,
    password: `${crypto.randomUUID()}Aa1!`,
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

let order = 0
/** a new issue in a team; returns the row */
export async function newIssue(who: Someone, ws: string, team: string, more: Partial<Database['public']['Tables']['issues']['Insert']> = {}) {
  return ok(
    who.db
      .from('issues')
      .insert({ id: ulid(), workspace_id: ws, team_id: team, title: 'Test issue', sort_order: `a${order++}`, ...more })
      .select()
      .single(),
  )
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
  /** waits for a message matching `pred`, or returns undefined after `ms` */
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
  const waitFor = async (pred: (m: Change) => boolean, ms = 3000) => {
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
  'teams',
  'team_members',
  'labels',
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
] as const satisfies readonly TableName[]

/** the column that says which workspace a row belongs to */
export const wsColumn = (t: TableName) => (t === 'workspaces' ? 'id' : t === 'profiles' ? 'guest_of' : 'workspace_id')

export const DISPLAY = { layout: 'list', grouping: 'status', ordering: 'manual', showCompleted: true, showSubIssues: true }
