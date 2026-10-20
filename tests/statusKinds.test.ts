import { describe, expect, test } from 'bun:test'
import { KIND_TEXT } from '@/features/settings/statusKinds'
import { COLOR_NAMES, LABEL_COLORS, STATUS_COLORS } from '@/model/colors'

describe('Settings › Statuses words', () => {
  test('issue and project groups say what they decide and how to split them', () => {
    for (const kind of ['issue', 'project'] as const) {
      for (const g of KIND_TEXT[kind].groups) expect({ kind, id: g.id, ok: !!g.description && g.example.startsWith('like ') }).toEqual({ kind, id: g.id, ok: true })
    }
  })

  test('every colour people pick has a name a screen reader can say', () => {
    for (const c of new Set([...STATUS_COLORS, ...LABEL_COLORS])) expect({ c, name: COLOR_NAMES[c] }).toEqual({ c, name: expect.any(String) })
  })
})
