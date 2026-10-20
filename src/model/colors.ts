/** The colours people pick from for labels and statuses: a calm set, so meaning stands out and nothing shouts. */

/** label colours; a new label takes the next one */
export const LABEL_COLORS = ['#eb5757', '#f2994a', '#f2c94c', '#4cb782', '#26b5ce', '#5e6ad2', '#bb87fc', '#f7a8d8', '#95a2b3']

/** status colours: two greys (Backlog's and Todo's), then the label colours */
export const STATUS_COLORS = ['#8a8f98', '#c4c6cc', ...LABEL_COLORS]
