/**
 * Removes what a database test run left behind: its pictures, then its workspaces, accounts and sign-up codes
 * (supabase/dev/cleanup-test-run.sql). Other runs, also ones still going, are left alone. Every `bun run test:db`
 * calls this for its own run when it ends (tests/db/preload.ts). By hand:
 *
 *   bun run test:db:clean <run>    one run (its name is in its accounts: dbtest-<run>-ana@…)
 *   bun run test:db:clean --all    every run's leftovers (supabase/dev/cleanup-all-tests.sql): only when no other run
 *                                  is going
 *
 * Only for a development or throwaway project. Uses the Supabase CLI, linked to the project in .env.local.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ownerSql, RUN_NAME, storageRm } from './support'

const DEV = join(import.meta.dir, '..', '..', 'supabase', 'dev')

/** the names a run's accounts and workspaces start with ('all': every run's) */
function patterns(run: string | 'all') {
  if (run === 'all') return { email: 'dbtest-%', workspace: 'dbtest %' }
  if (!RUN_NAME.test(run)) throw new Error(`A test run's name is letters and digits only, not "${run}".`)
  return { email: `dbtest-${run}-%`, workspace: `dbtest ${run} %` }
}

/**
 * The run's pictures: the ones in its workspaces, and the ones its accounts added (also in workspaces it has deleted
 * already). Their paths in the bucket.
 */
export async function picturesOf(run: string | 'all'): Promise<string[]> {
  const p = patterns(run)
  const rows = await ownerSql<{ name: string }>(
    `select name from storage.objects where bucket_id = 'pictures' and (
       (storage.foldername(name))[1] in (select id::text from public.workspaces where name like '${p.workspace}')
       or owner_id in (select id::text from auth.users where email like '${p.email}'))`,
  )
  return rows.map((r) => r.name)
}

/** cleans up after a run (or every run): pictures first, while the database still says whose they are */
export async function cleanUp(run: string | 'all') {
  patterns(run)
  const pictures = await picturesOf(run)
  // a failure stops here, so a second try still finds them
  for (let i = 0; i < pictures.length; i += 50) await storageRm(pictures.slice(i, i + 50))
  const sql =
    run === 'all'
      ? readFileSync(join(DEV, 'cleanup-all-tests.sql'), 'utf8')
      : readFileSync(join(DEV, 'cleanup-test-run.sql'), 'utf8').replaceAll(":'run'", `'${run}'`)
  // without its comments: the CLI takes SQL that starts with "--" for one of its flags
  await ownerSql(sql.replace(/^\s*--.*\n/gm, ''))
  return { pictures: pictures.length }
}

if (import.meta.main) {
  const arg = process.argv[2]
  if (!arg) {
    console.error('Which run? bun run test:db:clean <run>, or --all for every run (only when no other run is going).')
    process.exit(1)
  }
  const run = arg === '--all' ? 'all' : arg
  const { pictures } = await cleanUp(run)
  console.log(`Cleaned up ${run === 'all' ? 'every test run' : `test run ${run}`} (${pictures} pictures).`)
}
