/**
 * Text made easy to search: lower case, without accents, so "lukasz" finds Łukasz and "zazolc" finds "Zażółć".
 * Every search box uses it, so typing without Polish letters works everywhere.
 */
export const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ł/g, 'l')

/** a name made comparable: no accents, no case, letters and digits only ("Łukasz B." → "lukaszb") */
export const plainName = (s: string) => plain(s).replace(/[^a-z0-9]/g, '')
