/** The colours people pick from for labels and statuses: a calm set, so meaning stands out and nothing shouts. */

/** label colours; a new label takes the next one */
export const LABEL_COLORS = ['#eb5757', '#f2994a', '#f2c94c', '#4cb782', '#26b5ce', '#5e6ad2', '#bb87fc', '#f7a8d8', '#95a2b3']

/** status colours: two greys (Backlog's and Todo's), then the label colours */
export const STATUS_COLORS = ['#8a8f98', '#c4c6cc', ...LABEL_COLORS]

/** what each colour is called, so a screen reader says "Use yellow", not a code */
export const COLOR_NAMES: Readonly<Record<string, string>> = {
  '#8a8f98': 'grey',
  '#c4c6cc': 'light grey',
  '#eb5757': 'red',
  '#f2994a': 'orange',
  '#f2c94c': 'yellow',
  '#4cb782': 'green',
  '#26b5ce': 'teal',
  '#5e6ad2': 'indigo',
  '#bb87fc': 'purple',
  '#f7a8d8': 'pink',
  '#95a2b3': 'slate',
}
