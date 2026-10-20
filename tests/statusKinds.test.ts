import { describe, expect, test } from 'bun:test'
import { KIND_TEXT } from '@/features/settings/statusKinds'
import { COLOR_NAMES, LABEL_COLORS, STATUS_COLORS } from '@/model/colors'
import { KIND_CATEGORIES, STATUS_KINDS } from '@/model/status'

describe('Settings › Statuses words', () => {
  test('every kind lists its groups, in order, each with a name', () => {
    for (const kind of STATUS_KINDS) {
      expect(KIND_TEXT[kind].groups.map((g) => g.id)).toEqual([...KIND_CATEGORIES[kind]])
      for (const g of KIND_TEXT[kind].groups) expect({ kind, id: g.id, named: g.name.length > 0 && g.name !== g.id }).toEqual({ kind, id: g.id, named: true })
    }
  })

  test('issue groups say what they decide and how to split them', () => {
    for (const g of KIND_TEXT.issue.groups) expect({ id: g.id, ok: !!g.description && g.example.startsWith('like ') }).toEqual({ id: g.id, ok: true })
  })

  test('every colour people pick has a name a screen reader can say', () => {
    for (const c of new Set([...STATUS_COLORS, ...LABEL_COLORS])) expect({ c, name: COLOR_NAMES[c] }).toEqual({ c, name: expect.any(String) })
  })
})
