/**
 * Loaded before every `bun test` (bunfig.toml). For a database test run (SPRAWNIEJ_DB_TESTS), it removes what the
 * run made once all its files are done, and only that: other runs going at the same time are left alone
 * (tests/db/cleanup.ts). SPRAWNIEJ_TEST_KEEP keeps it for a look; `bun run test:db:clean <run>` removes it later.
 * Plain `bun test` does nothing here.
 */
import { afterAll } from 'bun:test'

if (process.env.SPRAWNIEJ_DB_TESTS && !process.env.SPRAWNIEJ_TEST_KEEP) {
  afterAll(async () => {
    const { RUN, madeAnything } = await import('./support')
    if (!madeAnything()) return
    const { cleanUp } = await import('./cleanup')
    try {
      const { pictures } = await cleanUp(RUN)
      console.log(`Cleaned up test run ${RUN} (${pictures} pictures).`)
    } catch (e) {
      throw new Error(`Cleaning up test run ${RUN} failed. Try again with: bun run test:db:clean ${RUN}\n${(e as Error).message}`)
    }
  }, 300_000)
}
