/**
 * A small Linear workspace for the import tests: tests/linearImport.test.ts and tests/importRows.test.ts work it out,
 * tests/db/import-linear.test.ts saves it to a real database, and the browser check serves it as a pretend Linear
 * (page.route on api.linear.app, answering each query by its root field).
 */
import type { LinearData } from '@/features/import/linearApi'

const issue = (o: Partial<LinearData['issues'][number]> & { id: string; number: number; title: string }): LinearData['issues'][number] => ({
  description: '',
  priority: 0,
  sortOrder: o.number,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  completedAt: null,
  canceledAt: null,
  state: { name: 'Todo', type: 'unstarted' },
  team: { id: 't-eng' },
  assignee: null,
  creator: { id: 'u-ana' },
  project: null,
  parent: null,
  labels: { nodes: [] },
  ...o,
})

export const linearFixture: LinearData = {
  org: { name: 'Acme', urlKey: 'acme' },
  teams: [
    { id: 't-eng', key: 'ENG', name: 'Engineering', icon: 'Rocket' },
    { id: 't-des', key: 'DES', name: 'Design', icon: '🎨' },
  ],
  users: [
    { id: 'u-ana', name: 'Ana Nowak', displayName: 'ana', email: 'ana@acme.dev', avatarUrl: null, active: true },
    { id: 'u-bob', name: 'Bob Stone', displayName: 'bob', email: 'bstone@acme.dev', avatarUrl: null, active: true },
    { id: 'u-old', name: 'Old Timer', displayName: 'old', email: null, avatarUrl: null, active: false },
    // only ever subscribed: no issue is hers, no comment
    { id: 'u-cat', name: 'Cat Wong', displayName: 'cat', email: null, avatarUrl: 'https://example.com/cat.png', active: true },
  ],
  labels: [
    { id: 'l-bug', name: 'Bug', color: '#eb5757', isGroup: false, parent: null },
    { id: 'l-bug2', name: 'bug', color: '#eb5757', isGroup: false, parent: null },
    { id: 'l-area', name: 'Area', color: '#5e6ad2', isGroup: true, parent: null },
    { id: 'l-charts', name: 'Charts', color: '#5e6ad2', isGroup: false, parent: { id: 'l-area', name: 'Area' } },
    { id: 'l-unused', name: 'Unused', color: '#000000', isGroup: false, parent: null },
  ],
  projects: [
    { id: 'p-launch', name: 'Launch', icon: 'Flag', description: 'Ship it', targetDate: '2026-12-01', createdAt: '2026-01-01T00:00:00.000Z', status: { type: 'started' }, lead: { id: 'u-ana' }, teams: { nodes: [{ id: 't-eng' }] } },
    { id: 'p-other', name: 'Elsewhere', icon: null, description: '', targetDate: null, createdAt: '2026-01-01T00:00:00.000Z', status: { type: 'planned' }, lead: null, teams: { nodes: [{ id: 't-xyz' }] } },
  ],
  issues: [
    issue({ id: 'i-1', number: 1, title: 'Charts are slow', sortOrder: 30, priority: 2, dueDate: '2026-11-03', estimate: 5, state: { name: 'In Review', type: 'started' }, assignee: { id: 'u-bob' }, subscribers: { nodes: [{ id: 'u-bob' }, { id: 'u-ana' }, { id: 'u-cat' }] }, labels: { nodes: [{ id: 'l-bug' }, { id: 'l-charts' }] }, project: { id: 'p-launch' }, description: 'See https://linear.app/acme/issue/ENG-2/fix-axis and [ENG-2](https://linear.app/acme/issue/ENG-2/fix-axis) and https://linear.app/acme/issue/OPS-9/x' }),
    issue({ id: 'i-2', number: 2, title: 'Fix the axis', sortOrder: 10, parent: { id: 'i-1' }, labels: { nodes: [{ id: 'l-bug2' }] }, state: { name: 'Done', type: 'completed' }, completedAt: '2026-02-01T00:00:00.000Z' }),
    issue({ id: 'i-3', number: 3, title: 'Old idea', sortOrder: 20, state: { name: 'Triage', type: 'triage' }, creator: { id: 'u-old' } }),
    issue({ id: 'i-9', number: 9, title: 'New logo', team: { id: 't-des' }, state: { name: 'Cancelled', type: 'canceled' }, canceledAt: '2026-03-01T00:00:00.000Z' }),
  ],
  views: [
    { id: 'v-bugs', name: 'Open bugs', description: 'Bugs still to fix', icon: 'Bug', shared: true, team: { id: 't-eng' }, owner: { id: 'u-ana' }, createdAt: '2026-01-05T00:00:00.000Z',
      filterData: { and: [{ state: { type: { in: ['unstarted', 'started'] } } }, { labels: { some: { id: { eq: 'l-bug' } } } }] } },
    { id: 'v-bob', name: 'Bob’s urgent work', description: null, icon: null, shared: true, team: null, owner: { id: 'u-bob' }, createdAt: '2026-01-05T00:00:00.000Z',
      filterData: { assignee: { id: { eq: 'u-bob' } }, priority: { in: [1, 2] }, team: { key: { eq: 'ENG' } }, state: { id: { eq: 's-review' } } } },
    { id: 'v-fuzzy', name: 'Recent launch work', description: null, icon: null, shared: true, team: { id: 't-eng' }, owner: { id: 'u-old' }, createdAt: '2026-01-05T00:00:00.000Z',
      filterData: { state: { type: { neq: 'completed' } }, createdAt: { gt: 'P-2W' }, project: { id: { eq: 'p-launch' } } } },
    { id: 'v-free', name: 'Nobody’s', description: null, icon: null, shared: false, team: { id: 't-eng' }, owner: null, createdAt: '2026-01-05T00:00:00.000Z',
      filterData: { assignee: { null: true } } },
    // the way Linear's app saves them: choices listed inside each field, labels matching their sub-labels too
    { id: 'v-area', name: '@ Area', description: null, icon: null, shared: true, team: { id: 't-eng' }, owner: null, createdAt: '2026-01-05T00:00:00.000Z',
      filterData: { and: [{ or: [] }, { labels: { and: [{ or: [{ name: { eq: 'Area' } }, { parent: { name: { eq: 'Area' } } }] }] } }] } },
    { id: 'v-unused', name: '@ Unused', description: null, icon: null, shared: true, team: { id: 't-eng' }, owner: null, createdAt: '2026-01-05T00:00:00.000Z',
      filterData: { and: [{ labels: { and: [{ or: [{ name: { eq: 'Unused' } }, { parent: { name: { eq: 'Unused' } } }] }] } }] } },
    { id: 'v-ana', name: 'Ana', description: null, icon: null, shared: true, team: { id: 't-eng' }, owner: null, createdAt: '2026-01-05T00:00:00.000Z',
      filterData: { and: [{ assignee: { or: [{ id: { in: ['u-ana'] } }] } }] } },
    { id: 'v-subs', name: 'Bob follows', description: null, icon: null, shared: true, team: { id: 't-eng' }, owner: null, createdAt: '2026-01-05T00:00:00.000Z',
      filterData: { and: [{ subscribers: { or: [{ id: { in: ['u-bob'] } }] } }] } },
    { id: 'v-either', name: 'Bob’s or followed', description: null, icon: null, shared: true, team: { id: 't-eng' }, owner: null, createdAt: '2026-01-05T00:00:00.000Z',
      filterData: { or: [{ assignee: { or: [{ id: { in: ['u-bob'] } }] } }, { subscribers: { or: [{ id: { in: ['u-bob'] } }] } }] } },
    { id: 'v-cat', name: 'Cat', description: null, icon: null, shared: true, team: { id: 't-eng' }, owner: { id: 'u-cat' }, createdAt: '2026-01-05T00:00:00.000Z',
      filterData: { and: [{ subscribers: { or: [{ id: { in: ['u-cat'] } }] } }] } },
    { id: 'v-des', name: 'Design only', description: null, icon: null, shared: true, team: { id: 't-des' }, owner: null, createdAt: '2026-01-05T00:00:00.000Z', filterData: {} },
  ],
  states: [{ id: 's-review', name: 'In Review', type: 'started' }],
  comments: [
    { id: 'c-1', body: 'On it', createdAt: '2026-01-03T00:00:00.000Z', user: { id: 'u-bob', name: 'Bob Stone' }, issue: { id: 'i-1' } },
    { id: 'c-2', body: 'Back in my day', createdAt: '2026-01-04T00:00:00.000Z', user: { id: 'u-old', name: 'Old Timer' }, issue: { id: 'i-1' } },
    { id: 'c-3', body: 'Not ours', createdAt: '2026-01-04T00:00:00.000Z', user: { id: 'u-bob', name: 'Bob Stone' }, issue: { id: 'i-elsewhere' } },
  ],
}
