import { describe, expect, test } from 'bun:test'
import { readLast, repoFromInput, type LastPullRequest } from '@/backend/github'
import { lastText, listRefs } from '@/features/settings/githubText'

describe('a repository from what someone typed', () => {
  test('owner/name, its address, or a link inside it', () => {
    expect(repoFromInput(' acme/web ')).toBe('acme/web')
    expect(repoFromInput('https://github.com/acme/web.git')).toBe('acme/web')
    expect(repoFromInput('github.com/Acme-Co/my.site/')).toBe('Acme-Co/my.site')
    expect(repoFromInput('git@github.com:acme/web.git')).toBe('acme/web')
    expect(repoFromInput('https://github.com/acme/web/pull/3')).toBe('acme/web')
  })

  test('anything else is not one', () => {
    for (const s of ['', 'acme', 'acme/', '/web', 'ac me/web', '-acme/web', 'acme/w b', 'https://gitlab.com/acme/web']) expect({ s, r: repoFromInput(s) }).toEqual({ s, r: null })
  })
})

describe('the latest pull request', () => {
  const base: LastPullRequest = { number: 12, url: null, title: '', login: 'octocat', to: 'done', refs: ['ENG-1'], moved: ['ENG-1'], skipped: false }

  test('read from whatever was saved', () => {
    expect(readLast(null)).toBeNull()
    expect(readLast({ number: 12, url: 'javascript:alert(1)', to: 'nope', refs: ['ENG-1', 3], moved: 'x', skipped: 'author' })).toEqual({
      number: 12,
      url: null,
      title: '',
      login: null,
      to: null,
      refs: ['ENG-1'],
      moved: [],
      skipped: true,
    })
  })

  test('in words', () => {
    expect(listRefs(['A-1', 'A-2', 'A-3'])).toBe('A-1, A-2 and A-3')
    expect(lastText(base)).toBe('moved ENG-1 to Done')
    expect(lastText({ ...base, to: 'in_review', moved: ['ENG-1', 'ENG-2'] })).toBe('moved ENG-1 and ENG-2 to In Review')
    expect(lastText({ ...base, skipped: true, moved: [] })).toBe("moved nothing: @octocat isn't in this workspace with GitHub as a way to sign in")
    expect(lastText({ ...base, refs: [], moved: [] })).toBe('mentions no issue')
    expect(lastText({ ...base, moved: [] })).toBe('moved nothing: ENG-1 is already further along, archived or not here')
    expect(lastText({ ...base, refs: ['A-1', 'A-2', 'A-3', 'A-4'], moved: [] })).toBe('moved nothing: A-1, A-2 and A-3 and more are already further along, archived or not here')
  })
})
