import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { closeChannels, enabled, expectDenied, getWorld, newIssue, newTeam, newWorkspace, ok, ulid, type World } from './support'

describe.skipIf(!enabled)('issue numbers', () => {
  let w: World
  let num: string
  let other: string
  beforeAll(async () => {
    w = await getWorld()
    num = await newTeam(w.ana, w.ws, 'NUM')
    other = await newTeam(w.ana, w.ws, 'NUMB')
  }, 60_000)
  afterAll(closeChannels)

  const lastNumber = async (team: string) =>
    (await ok(w.ana.db.from('teams').select('last_number').eq('id', team).single())).last_number

  test('issues created at the same moment get different numbers, one after another', async () => {
    const made = await Promise.all(Array.from({ length: 10 }, (_, n) => newIssue(n % 2 ? w.bob : w.ana, w.ws, num)))
    const numbers = made.map((i) => i.number).sort((a, b) => a - b)
    expect(numbers).toEqual(Array.from({ length: 10 }, (_, n) => numbers[0] + n))
    expect(await lastNumber(num)).toBe(numbers[9])
  })

  test('a deleted issue’s number is never given out again', async () => {
    const last = await newIssue(w.ana, w.ws, num)
    await ok(w.ana.db.from('issues').delete().eq('id', last.id))
    expect((await newIssue(w.ana, w.ws, num)).number).toBe(last.number + 1)
  })

  test('moving an issue to another team gives it a number there and keeps the old one', async () => {
    const issue = await newIssue(w.ana, w.ws, num)
    const moved = await ok(w.bob.db.rpc('move_issue_to_team', { p_issue: issue.id, p_team: other }))
    expect(moved.team_id).toBe(other)
    expect(moved.former_refs).toEqual([`NUM-${issue.number}`])
    expect((await newIssue(w.ana, w.ws, num)).number).not.toBe(issue.number)
    const used = await ok(w.ana.db.from('issue_numbers').select('team_id, number').eq('workspace_id', w.ws).in('team_id', [num, other]))
    expect(used).toContainEqual({ team_id: num, number: issue.number })
    expect(used).toContainEqual({ team_id: other, number: moved.number })

    const elsewhere = await newWorkspace(w.ana, 'numbers')
    const { error } = await w.ana.db.rpc('move_issue_to_team', { p_issue: issue.id, p_team: elsewhere.team })
    expect(error).not.toBeNull()
  })

  test('numbers, authors and times are the database’s to set', async () => {
    const base = () => ({ id: ulid(), workspace_id: w.ws, team_id: num, title: 'x', sort_order: 'a0' })
    await expectDenied(w.ana.db.from('issues').insert({ ...base(), number: 9999 }))
    await expectDenied(w.ana.db.from('issues').insert({ ...base(), created_by: w.bob.profileId }))
    await expectDenied(w.ana.db.from('issues').insert({ ...base(), changed_at: '2020-01-01T00:00:00Z' }))
    const issue = await newIssue(w.ana, w.ws, num)
    expect(issue.created_by).toBe(w.ana.profileId)
    await expectDenied(w.ana.db.from('issues').update({ number: 9999 }).eq('id', issue.id))
    await expectDenied(w.ana.db.from('issues').update({ team_id: other }).eq('id', issue.id))
    await expectDenied(w.ana.db.from('teams').update({ last_number: 0 }).eq('id', num))
    await expectDenied(w.ana.db.from('teams').update({ key: 'XX' }).eq('id', num))
  })
})
