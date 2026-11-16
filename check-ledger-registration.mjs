// Is my (author: desktop) ledger registration still being enforced?
//
// AGENTS.md changed the reconciliation rule to author-pairing: an entry counts as
// REGISTERED only when it carries BOTH `author` and `docMarker`, and that marker
// must appear in AGENTS.md as `<!-- ledger:<marker> -->`. Entries written under the
// OLD schema (date/claim/verdict/how/cost/rootCause) have neither field — so under
// the new rule they are silently excluded from reconciliation rather than flagged.
//
// That is the failure this script looks for: my conclusions still being cited in
// AGENTS.md by hand, while no automated check can tell whether they drifted.

import { readFileSync } from 'node:fs'

const WS = 'D:/deepseek'
const ledger = JSON.parse('[' + readFileSync(`${WS}/assumption-ledger.jsonl`, 'utf8').trim().split(/\r?\n/).join(',') + ']')
const agents = readFileSync(`${WS}/AGENTS.md`, 'utf8').replace(/^\uFEFF/, '')

console.log(`ledger entries = ${ledger.length}`)

const withAuthor = ledger.filter((e) => e.author !== undefined)
const withMarker = ledger.filter((e) => e.docMarker !== undefined)
console.log(`  with author    = ${withAuthor.length}`)
console.log(`  with docMarker = ${withMarker.length}`)
console.log('  authors:')
const byAuthor = {}
for (const e of ledger) byAuthor[e.author ?? '(none)'] = (byAuthor[e.author ?? '(none)'] ?? 0) + 1
for (const [a, n] of Object.entries(byAuthor)) console.log(`    ${a}: ${n}`)

// My entries, located by a distinctive fragment of each claim.
const MINE = [
  ['插件', 'capabilities-on-disk', /要增强能力就得去?装插件/],
  ['DSH home', 'dsh-home-write', /DSH home 是配置文件所在地/],
  ['静态检查器', 'preset-checker-static', /复刻了 mount 校验的静态部分/],
  ['headless', 'headless-cannot-verify-presets', /headless 起一次性会话/],
  ['overlay insert', 'overlay-id-override', /overlay 的.insert.就行/],
  ['abspath', 'use-programs-own-path', /check_three_features 的失败是写盘相关/],
  ['路径拼接', 'path-concat-no-separator', /USERPROFILE.*\.dsh.*拼出的路径不存在/],
  ['量具版本', 'audit-instrument-version', /用自己写的抽取器比对压缩前后的文本/],
]

console.log('')
console.log(`---- my ${MINE.length} entries: registered under the NEW rule? ----`)
let unregistered = 0
for (const [label, hint, re] of MINE) {
  const hit = ledger.find((e) => re.test(e.claim ?? ''))
  if (!hit) {
    console.log(`  ${label.padEnd(16)} NOT FOUND in ledger`)
    unregistered++
    continue
  }
  const hasAuthor = hit.author !== undefined
  const hasMarker = hit.docMarker !== undefined
  const inAgents = hasMarker ? agents.includes(`<!-- ledger:${hit.docMarker} -->`) : false
  const registered = hasAuthor && hasMarker && inAgents
  if (!registered) unregistered++
  console.log(
    `  ${label.padEnd(16)} author=${hasAuthor ? hit.author : 'MISSING'} marker=${
      hasMarker ? hit.docMarker : 'MISSING'
    } markerInAgentsMd=${inAgents}  -> ${registered ? 'REGISTERED' : 'NOT ENFORCED'}`,
  )
}

console.log('')
console.log(`my entries not enforced by reconciliation = ${unregistered}/${MINE.length}`)

// Marker collisions: another author may already own a marker name.
const markers = ledger.filter((e) => e.docMarker).map((e) => e.docMarker)
const dupes = markers.filter((m, i) => markers.indexOf(m) !== i)
console.log(`duplicate docMarkers across ledger = ${dupes.length ? dupes.join(', ') : 'none'}`)
