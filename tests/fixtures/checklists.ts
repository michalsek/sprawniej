/**
 * Checklist texts and ticks, shared by the app's helpers (tests/checklist.test.ts) and the database function
 * set_checklist_item (tests/db/checklist.test.ts), so both find the same items and make the same change.
 */

interface Tick {
  /** the how-manieth item, from 0 */
  item: number
  /** what the person saw it say */
  text: string
  checked: boolean
  /** the text afterwards; null when the tick is refused (the item changed meanwhile) */
  after: string | null
}

export interface ChecklistCase {
  name: string
  md: string
  /** the items found, in order */
  items: { text: string; checked: boolean }[]
  ticks: Tick[]
}

export const CHECKLISTS: ChecklistCase[] = [
  {
    name: 'a plain checklist',
    md: 'Before the release:\n\n- [ ] write notes\n- [x] fix the bug\n- [ ] tell the team',
    items: [
      { text: 'write notes', checked: false },
      { text: 'fix the bug', checked: true },
      { text: 'tell the team', checked: false },
    ],
    ticks: [
      { item: 0, text: 'write notes', checked: true, after: 'Before the release:\n\n- [x] write notes\n- [x] fix the bug\n- [ ] tell the team' },
      { item: 1, text: 'fix the bug', checked: false, after: 'Before the release:\n\n- [ ] write notes\n- [ ] fix the bug\n- [ ] tell the team' },
      // already that way: nothing changes
      { item: 1, text: 'fix the bug', checked: true, after: 'Before the release:\n\n- [ ] write notes\n- [x] fix the bug\n- [ ] tell the team' },
    ],
  },
  {
    name: 'other list marks and a capital X stay as they were',
    md: '* [X] a\n+ [ ] b\n  - [ ] nested',
    items: [
      { text: 'a', checked: true },
      { text: 'b', checked: false },
      { text: 'nested', checked: false },
    ],
    ticks: [
      { item: 1, text: 'b', checked: true, after: '* [X] a\n+ [x] b\n  - [ ] nested' },
      { item: 0, text: 'a', checked: false, after: '* [ ] a\n+ [ ] b\n  - [ ] nested' },
      { item: 2, text: 'nested', checked: true, after: '* [X] a\n+ [ ] b\n  - [x] nested' },
    ],
  },
  {
    name: 'items in a quote, empty items and spaces around the text',
    md: '> - [ ] quoted\n- [ ]\n- [ ] spaced   \n-\t[ ]   wide',
    items: [
      { text: 'quoted', checked: false },
      { text: '', checked: false },
      { text: 'spaced', checked: false },
      { text: 'wide', checked: false },
    ],
    ticks: [
      { item: 0, text: 'quoted', checked: true, after: '> - [x] quoted\n- [ ]\n- [ ] spaced   \n-\t[ ]   wide' },
      { item: 1, text: '', checked: true, after: '> - [ ] quoted\n- [x]\n- [ ] spaced   \n-\t[ ]   wide' },
      { item: 2, text: 'spaced', checked: true, after: '> - [ ] quoted\n- [ ]\n- [x] spaced   \n-\t[ ]   wide' },
      { item: 3, text: 'wide', checked: true, after: '> - [ ] quoted\n- [ ]\n- [ ] spaced   \n-\t[x]   wide' },
    ],
  },
  {
    name: 'lines in code blocks are not items',
    md: '```\n- [ ] in code\n```\n- [ ] real\n~~~~md\n- [ ] also code\n~~~\n- [ ] still code\n~~~~\n- [x] last',
    items: [
      { text: 'real', checked: false },
      { text: 'last', checked: true },
    ],
    ticks: [
      { item: 0, text: 'real', checked: true, after: '```\n- [ ] in code\n```\n- [x] real\n~~~~md\n- [ ] also code\n~~~\n- [ ] still code\n~~~~\n- [x] last' },
      { item: 1, text: 'last', checked: false, after: '```\n- [ ] in code\n```\n- [ ] real\n~~~~md\n- [ ] also code\n~~~\n- [ ] still code\n~~~~\n- [ ] last' },
    ],
  },
  {
    name: 'code blocks inside a list item or a quote, and Windows line ends',
    md: '- a\n\n    ```\n    - [ ] in code\n    ```\n- [ ] real\n> ```\n> - [ ] quoted code\n> ```\n- [ ] after\r\n```\r\n- [ ] crlf code\r\n```\r\n- [x]\r\n- [ ] last\r',
    items: [
      { text: 'real', checked: false },
      { text: 'after', checked: false },
      { text: '', checked: true },
      { text: 'last', checked: false },
    ],
    ticks: [
      { item: 0, text: 'real', checked: true, after: '- a\n\n    ```\n    - [ ] in code\n    ```\n- [x] real\n> ```\n> - [ ] quoted code\n> ```\n- [ ] after\r\n```\r\n- [ ] crlf code\r\n```\r\n- [x]\r\n- [ ] last\r' },
      { item: 2, text: '', checked: false, after: '- a\n\n    ```\n    - [ ] in code\n    ```\n- [ ] real\n> ```\n> - [ ] quoted code\n> ```\n- [ ] after\r\n```\r\n- [ ] crlf code\r\n```\r\n- [ ]\r\n- [ ] last\r' },
      { item: 3, text: 'last', checked: true, after: '- a\n\n    ```\n    - [ ] in code\n    ```\n- [ ] real\n> ```\n> - [ ] quoted code\n> ```\n- [ ] after\r\n```\r\n- [ ] crlf code\r\n```\r\n- [x]\r\n- [x] last\r' },
    ],
  },
  {
    name: 'code inside a line is not a code block',
    md: '```x``` text\n- [ ] counted\n~~~ js `a`\n- [ ] in code\n~~~\n- [x] after',
    items: [
      { text: 'counted', checked: false },
      { text: 'after', checked: true },
    ],
    ticks: [
      { item: 0, text: 'counted', checked: true, after: '```x``` text\n- [x] counted\n~~~ js `a`\n- [ ] in code\n~~~\n- [x] after' },
      { item: 1, text: 'after', checked: false, after: '```x``` text\n- [ ] counted\n~~~ js `a`\n- [ ] in code\n~~~\n- [ ] after' },
    ],
  },
  {
    name: 'not items: numbered, no space, no box',
    md: '1. [ ] numbered\n-[ ] tight\n- [ ]x\n- [y] other\n- plain',
    items: [],
    ticks: [{ item: 0, text: 'numbered', checked: true, after: null }],
  },
  {
    name: 'changed meanwhile: found by its text, or refused',
    md: '- [ ] new first\n- [ ] milk\n- [ ] bread\n- [ ] bread',
    items: [
      { text: 'new first', checked: false },
      { text: 'milk', checked: false },
      { text: 'bread', checked: false },
      { text: 'bread', checked: false },
    ],
    ticks: [
      // a teammate added an item above: "milk" was item 0 when it was ticked, and is found by its text
      { item: 0, text: 'milk', checked: true, after: '- [ ] new first\n- [x] milk\n- [ ] bread\n- [ ] bread' },
      // the item still says it at its place
      { item: 3, text: 'bread', checked: true, after: '- [ ] new first\n- [ ] milk\n- [ ] bread\n- [x] bread' },
      // moved, and two items say it: which one is meant can't be told
      { item: 1, text: 'bread', checked: true, after: null },
      // reworded or deleted
      { item: 1, text: 'eggs', checked: true, after: null },
    ],
  },
]
