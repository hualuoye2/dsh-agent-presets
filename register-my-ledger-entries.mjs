// Keep MY six conclusions under the automated ledger check — both halves of it.
//
// AGENTS.md's rule (2026-10) treats an entry as REGISTERED only when BOTH hold:
//   1. the ledger line carries `author` + `docMarker`;
//   2. AGENTS.md contains `<!-- ledger:<docMarker> -->` for it.
// Writing only one half makes `capmap.ps1` report a mismatch; writing NEITHER
// makes it report "reconciled OK" while checking nothing at all — a green light
// over an unchecked set, which is the failure this script exists to fix.
//
// Idempotent: already-tagged lines / already-marked rows are left alone.
// Other authors' entries are never touched (matched by my claim fragments only).

import { readFileSync, writeFileSync } from 'node:fs'

const LEDGER = 'D:/deepseek/assumption-ledger.jsonl'
const AGENTS_MD = 'D:/deepseek/AGENTS.md'
const AUTHOR = 'desktop'

// [ledger claim fragment, docMarker, AGENTS.md row anchor]
const MINE = [
  ['要增强能力就得去装插件', 'capabilities-on-disk', '"要增强能力就得装插件"'],
  ['DSH home 是配置文件所在地', 'dsh-home-write', '"DSH home 在配置旁边，所以 PS 能写"'],
  ['复刻了 mount 校验的静态部分', 'preset-checker-static', '"我复刻了 mount 校验的静态部分'],
  ['headless 起一次性会话', 'headless-cannot-verify-presets', '能校验 preset 挂载"'],
  ['overlay 的 insert 就行', 'overlay-id-override', '"overlay 改 preset 默认值用'],
  ['check_three_features 的失败是写盘相关', 'use-programs-own-path', '"文档说 `check_three_features` 失败是写盘相关'],
]

// ── 1. ledger ───────────────────────────────────────────────────────────────
const rawLedger = readFileSync(LEDGER, 'utf8')
const ledgerLines = rawLedger.replace(/^\uFEFF/, '').split(/\r?\n/)
const seen = new Set()
let tagged = 0
const outLedger = ledgerLines.map((line) => {
  if (!line.trim()) return line
  let obj
  try {
    obj = JSON.parse(line)
  } catch {
    return line
  }
  const hit = MINE.find(([frag]) => (obj.claim ?? '').includes(frag))
  if (!hit) return line
  seen.add(hit[1])
  if (obj.author !== undefined && obj.docMarker !== undefined) return line
  tagged++
  return JSON.stringify({ ...obj, author: AUTHOR, docMarker: hit[1] })
})
writeFileSync(LEDGER, outLedger.join('\n'), 'utf8')

// ── 2. AGENTS.md markers ────────────────────────────────────────────────────
const rawMd = readFileSync(AGENTS_MD, 'utf8')
const mdLines = rawMd.replace(/^\uFEFF/, '').split(/\r?\n/)
let marked = 0
const already = new Set()
const outMd = mdLines.map((line) => {
  for (const [, marker, anchor] of MINE) {
    if (!line.includes(anchor)) continue
    if (line.includes(`<!-- ledger:${marker} -->`)) {
      already.add(marker)
      return line
    }
    // Only the trailing unregistered cell on a table row is rewritten.
    if (!/\|\s*—\s*\|\s*$/.test(line)) continue
    marked++
    return line.replace(/\|\s*—\s*\|\s*$/, `| <!-- ledger:${marker} --> |`)
  }
  return line
})
writeFileSync(AGENTS_MD, outMd.join('\n'), 'utf8')

// ── report ──────────────────────────────────────────────────────────────────
const missingLedger = MINE.filter(([, m]) => !seen.has(m)).map(([, m]) => m)
console.log(`ledger : newly tagged = ${tagged}`)
console.log(`AGENTS : newly marked = ${marked}   (already marked = ${already.size})`)
console.log(`markers: ${MINE.map(([, m]) => m).join(', ')}`)
if (missingLedger.length) {
  console.log('')
  console.log('!! claim fragments matching NOTHING (text drifted?):')
  for (const m of missingLedger) console.log('   ' + m)
}
process.exit(missingLedger.length === 0 ? 0 : 1)
