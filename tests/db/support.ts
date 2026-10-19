/**
 * Shared pieces for the database tests in tests/db. They talk to a real Supabase project through its API, as
 * throwaway accounts, so they only run with SPRAWNIEJ_DB_TESTS set (`bun run test:db`). Plain `bun test` imports
 * these files and skips them: nothing here may connect or throw at import time.
 *
 * The project comes from VITE_SUPABASE_URL and VITE_SUPABASE_KEY (the environment, or .env.local).
 * Test accounts are dbtest-<run>-<name>@<domain>; supabase/dev/cleanup-tests.sql removes them afterwards.
 */
import { expect } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { ulid as makeUlid } from 'ulid'

export const enabled = !!process.env.SPRAWNIEJ_DB_TESTS

/** one run of the tests: every account, login and workspace name carries it */
export const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 4)

/** Auth refuses example and test domains, so the default is a real (throwaway) mail domain. */
const DOMAIN = process.env.SPRAWNIEJ_TEST_EMAIL_DOMAIN ?? 'mailinator.com'

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

const clients: SupabaseClient[] = []

export function client(): SupabaseClient {
  const { url, key } = env()
  const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  clients.push(c)
  return c
}

export interface Person {
  name: string
  db: SupabaseClient
  userId: string
  profileId: string
  login: string
}

/** a new account with a profile (login dbt-<run>-<name>) */
export async function signUp(name: string): Promise<Person> {
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
  await db.realtime.setAuth(data.session.access_token)
  const login = `dbt-${RUN}-${name}`
  const profile = await ok(db.rpc('create_profile', { p_login: login, p_name: `Test ${name}` }).maybeSingle<{ id: string }>())
  return { name, db, userId: data.user.id, profileId: profile!.id, login }
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

let world: Promise<World> | undefined

/** One shared world per `bun test` run, so a run signs up only four accounts. */
export function getWorld(): Promise<World> {
  world ??= makeWorld()
  return world
}

async function makeWorld(): Promise<World> {
  const [ana, bob, cy, dee] = await Promise.all(['ana', 'bob', 'cy', 'dee'].map(signUp))
  const ws = await newWorkspace(ana, 'main')
  const eng = (await ok(ana.db.from('teams').select('id').eq('workspace_id', ws).eq('key', 'ENG').single<{ id: string }>())).id
  const des = await newTeam(ana, ws, 'DES')
  await addMember(ana, bob, ws)
  const guest = crypto.randomUUID()
  const guestLogin = `~dbt-${RUN}-g1`
  await ok(ana.db.rpc('import_rows', { p_ws: ws, p_table: 'profiles', p_rows: [{ id: guest, login: guestLogin, name: 'Guest One' }] }))
  return { ana, bob, cy, dee, ws, eng, des, guest, guestLogin }
}

/** a workspace owned by `owner`, with team ENG */
export async function newWorkspace(owner: Person, label: string): Promise<string> {
  return ok(owner.db.rpc('create_workspace', { p_name: `dbtest ${RUN} ${label}`, p_team_key: 'ENG', p_team_name: 'Engineering', p_team_emoji: '' })) as Promise<string>
}

export async function newTeam(who: Person, ws: string, key: string): Promise<string> {
  const id = crypto.randomUUID()
  await ok(who.db.from('teams').insert({ id, workspace_id: ws, key, name: key }))
  return id
}

/** `admin` invites `person` (as `role`), and they accept */
export async function addMember(admin: Person, person: Person, ws: string, role: 'member' | 'admin' = 'member') {
  const inv = await ok(admin.db.from('invites').insert({ workspace_id: ws, role }).select('token').single<{ token: string }>())
  await ok(person.db.rpc('accept_invite', { p_token: inv.token }))
}

export const ulid = () => makeUlid()

let order = 0
/** a new issue in a team; returns the row */
export async function newIssue(who: Person, ws: string, team: string, more: Record<string, unknown> = {}) {
  return ok(
    who.db
      .from('issues')
      .insert({ id: ulid(), workspace_id: ws, team_id: team, title: 'Test issue', sort_order: `a${order++}`, ...more })
      .select()
      .single<Record<string, any>>(),
  )
}

/** the data of a Supabase call, or a thrown error with its code. Writes without .select() give null; ignore it. */
export async function ok<T>(call: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await call
  if (error) throw new Error(`${error.code ?? ''} ${error.message}`)
  return data as NonNullable<T>
}

/** the call failed with a permission error */
export async function expectDenied(call: PromiseLike<{ error: { code?: string; message: string } | null }>) {
  const { error } = await call
  expect(error?.code).toBe('42501')
}

/** the call failed (any error); returns it */
export async function expectError(call: PromiseLike<{ error: { code?: string; message: string } | null }>, code?: string) {
  const { error } = await call
  expect(error).not.toBeNull()
  if (code) expect(error?.code).toBe(code)
  return error!
}

export interface Listener {
  channel: RealtimeChannel
  status: string
  got: Array<Record<string, any>>
  /** waits for a message matching `pred`, or returns undefined after `ms` */
  waitFor: (pred: (m: Record<string, any>) => boolean, ms?: number) => Promise<Record<string, any> | undefined>
}

/** joins a private channel and collects its "change" messages */
export async function listen(who: Person, topic: string): Promise<Listener> {
  const got: Array<Record<string, any>> = []
  // a client keeps one channel per topic; start over so a test hears only its own messages
  for (const c of who.db.getChannels()) if (c.topic === `realtime:${topic}`) await who.db.removeChannel(c)
  const channel = who.db.channel(topic, { config: { private: true } })
  channel.on('broadcast', { event: 'change' }, (m) => got.push(m.payload as Record<string, any>))
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
  const waitFor = async (pred: (m: Record<string, any>) => boolean, ms = 3000) => {
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
] as const

/** the column that says which workspace a row belongs to */
export const wsColumn = (t: string) => (t === 'workspaces' ? 'id' : t === 'profiles' ? 'guest_of' : 'workspace_id')

export const DISPLAY = { layout: 'list', grouping: 'status', ordering: 'manual', showCompleted: true, showSubIssues: true }
