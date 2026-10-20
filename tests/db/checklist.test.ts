import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { CHECKLISTS } from '../fixtures/checklists'
import { closeChannels, enabled, getWorld, newIssue, ok, type World } from './support'

/** set_checklist_item finds and changes items exactly as the app's helpers do (tests/checklist.test.ts) */
describe.skipIf(!enabled)('checklist ticks', () => {
  let w: World
  beforeAll(async () => {
    w = await getWorld()
  }, 60_000)
  afterAll(closeChannels)

  const tick = (who: World['ana'], issue: string, item: number, text: string, checked: boolean) =>
    who.db.rpc('set_checklist_item', { p_issue: issue, p_item: item, p_text: text, p_checked: checked })
  const events = async (issue: string) => ok(w.ana.db.from('issue_events').select('actor_id, changes').eq('issue_id', issue).order('id'))

  for (const c of CHECKLISTS) {
    test(`the same ticks as the app: ${c.name}`, async () => {
      const issue = await newIssue(w.ana, w.ws, w.eng, { description: c.md })
      for (const t of c.ticks) {
        await ok(w.ana.db.from('issues').update({ description: c.md }).eq('id', issue.id))
        const { data, error } = await tick(w.ana, issue.id, t.item, t.text, t.checked)
        if (t.after === null) {
          expect(error?.code).toBe('P0001')
          expect(error?.message).toBe("That checklist item changed meanwhile, so your tick wasn't saved. Have a look and tick it again.")
        } else {
          expect(error).toBeNull()
          expect(data?.description).toBe(t.after)
        }
      }
    })
  }

  test('any member may tick; it is a description change in the history, and ticking it again changes nothing', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng, { description: '- [ ] a\n- [ ] b' })
    const ticked = await ok(tick(w.bob, issue.id, 1, 'b', true))
    expect(ticked.description).toBe('- [ ] a\n- [x] b')
    const again = await ok(tick(w.bob, issue.id, 1, 'b', true))
    expect(again.changed_at).toBe(ticked.changed_at)
    expect(await events(issue.id)).toEqual([{ actor_id: w.bob.profileId, changes: { description: true } }])
  })

  test('someone outside the workspace finds no such issue', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng, { description: '- [ ] a' })
    const { error } = await tick(w.cy, issue.id, 0, 'a', true)
    expect(error?.code).toBe('P0002')
    expect((await ok(w.ana.db.from('issues').select('description').eq('id', issue.id).single())).description).toBe('- [ ] a')
  })
})
