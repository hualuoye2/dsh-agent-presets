// Independent occurrence counter (NOT the reporter's PowerShell regex).
// Counts exact, case-sensitive, overlapping substring occurrences of each needle,
// plus a case-insensitive count and a "loose dash" regex count (lookalike dashes).
// Usage: node count-occ.mjs <file> <needle> [needle...]
import { readFileSync } from 'node:fs'

const [file, ...needles] = process.argv.slice(2)
if (!file || !needles.length) throw new Error('usage: node count-occ.mjs <file> <needle> [needle...]')

const raw = readFileSync(file)
const text = raw.toString('utf8').replace(/^\uFEFF/, '')
const lineOf = (idx) => text.slice(0, idx).split('\n').length

console.log(`FILE            = ${file}`)
console.log(`BYTES           = ${raw.length}`)
console.log(`CHARS(utf8)     = ${text.length}`)
console.log(`HAS_CRLF        = ${text.includes('\r\n')}`)
console.log(`ENDS_WITH_LF    = ${text.endsWith('\n')}`)
console.log('')

for (const n of needles) {
  const hits = []
  let i = text.indexOf(n)
  while (i !== -1) {
    hits.push(i)
    i = text.indexOf(n, i + 1) // +1 => overlapping occurrences also counted
  }
  const lines = hits.map(lineOf)
  console.log(`NEEDLE_EXACT    = ${JSON.stringify(n)}`)
  console.log(`  COUNT_CASE_SENSITIVE = ${hits.length}`)
  console.log(`  AT_LINES             = [${lines.join(', ')}]`)
  const ci = text.toLowerCase().split(n.toLowerCase()).length - 1
  console.log(`  COUNT_CASE_INSENSITIVE = ${ci}`)
  const loose = n.replace(/-/g, '[-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015]')
  const m = text.match(new RegExp(loose, 'g'))
  console.log(`  COUNT_LOOSE_DASH_REGEX = ${m ? m.length : 0}   (pattern ${loose})`)
  console.log('')
}
