// Pre-flight for an AGENTS.md section replacement: catch L2 losses BEFORE splicing.
//
// Why: agmd-audit's L2 gate requires every digit token that was bound to a `##` section
// to STILL occur in that section. A replacement file that is a few hundred bytes lighter
// usually achieves that -- but "usually" is how you burn a write to AGENTS.md (and every
// write re-injects the whole file into the agent's context). This mirrors the audit's own
// token regex exactly, so a 0 here is the same set the audit will compare.
//
// Usage: node check-replacement.mjs <baseline.json> <ordinal> <replacement.md>
import { readFileSync } from 'node:fs'

const [, , baselinePath, ordArg, replPath] = process.argv
if (!baselinePath || !ordArg || !replPath) {
  console.error('usage: node check-replacement.mjs <baseline.json> <ordinal> <replacement.md>')
  process.exit(2)
}
const b = JSON.parse(readFileSync(baselinePath, 'utf8'))
const ord = String(ordArg)
const secToks = Object.entries(b.facts.bySection ?? {})
  .filter(([, secs]) => secs.includes(ord))
  .map(([t]) => t)
  .sort()
const text = readFileSync(replPath, 'utf8')
const got = new Set(text.match(/\b\d[\d,_]*\b/g) ?? [])
const missing = secToks.filter((t) => !got.has(t))

console.log(`节 ${ord} = ${b.facts.sectionTitles?.[ord] ?? '(unknown)'}`)
console.log(`替换文件 = ${replPath}  ${Buffer.byteLength(text, 'utf8')} 字节`)
console.log(`该节基线数字 token = ${secToks.length} 个：${secToks.join('  ')}`)
if (missing.length === 0) {
  console.log('OK：全部留在该节内（L2 不会报"迁出原小节"）')
} else {
  console.log(`MISSING ${missing.length} 个 —— 必须补回本文里：${missing.join('  ')}`)
  process.exit(1)
}
