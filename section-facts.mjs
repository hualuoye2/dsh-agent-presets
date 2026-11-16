// Read-only: list the digit tokens the audit binds to ONE `##` section of a snapshot.
// Why: before relocating prose out of AGENTS.md I need the exact set of numbers that
// will be reported as lost, per section -- guessing them from a diff is unreliable.
//
// Usage: node section-facts.mjs <baseline.json> <ordinal>
import { readFileSync } from 'node:fs'

const [, , baselinePath, ordArg] = process.argv
if (!baselinePath || !ordArg) {
  console.error('usage: node section-facts.mjs <baseline.json> <ordinal>')
  process.exit(2)
}
const b = JSON.parse(readFileSync(baselinePath, 'utf8'))
const ord = String(ordArg)
const title = b.facts.sectionTitles?.[ord]
console.log(`section ${ord} = ${title ?? '(none)'}`)
if (!title) process.exit(3)
const toks = Object.entries(b.facts.bySection)
  .filter(([, secs]) => secs.includes(ord))
  .map(([t]) => t)
  .sort((a, c) => Number(a.replace(/[,_]/g, '')) - Number(c.replace(/[,_]/g, '')))
console.log(`token 数 = ${toks.length}`)
console.log(toks.join('  '))
