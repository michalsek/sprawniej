import { describe, expect, test } from 'bun:test'
import { tidyMarkdown } from '@/editor/tidy'

describe('tidy Markdown', () => {
  test('links that show their own address become bare addresses', () => {
    expect(tidyMarkdown('see [https://example.com](https://example.com) or [docs](https://x.dev)')).toBe('see https://example.com or [docs](https://x.dev)')
    // empty lines typed at the end (or start) don't end up in the saved text as &nbsp;
    expect(tidyMarkdown('&nbsp;\n\nhi\n\n&nbsp;\n\nthere\n\n&nbsp;\n\n&nbsp;')).toBe('hi\n\n&nbsp;\n\nthere')
  })
  test('blank lines at the start and end go', () => {
    expect(tidyMarkdown('\n\n  \nHello\n\n')).toBe('Hello')
  })
})
