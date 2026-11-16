// Read EVERY zstd frame in a session file (not just the first) and report where
// `agentPreset` appears.
//
// Why: `zlib.zstdDecompressSync` returns only the FIRST frame, so a session record's
// header is all you normally see. If the runtime re-resolves a preset when a session
// is resumed, that would land in a later frame — invisible to a single-shot read.
//
// Usage: node session-frames-scan.mjs <session.v4.jsonl.zstd>

import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const file = process.argv[2]
if (!file) throw new Error('usage: node session-frames-scan.mjs <session.v4.jsonl.zstd>')
const buf = readFileSync(file)

// zstd frame magic: 28 B5 2F FD
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []
for (let i = 0; ; ) {
  const k = buf.indexOf(MAGIC, i)
  if (k < 0) break
  starts.push(k)
  i = k + 4
}
console.log(`  file      = ${file}`)
console.log(`  bytes     = ${buf.length}`)
console.log(`  zstd 帧数 = ${starts.length}`)

let all = ''
let okFrames = 0
for (let n = 0; n < starts.length; n++) {
  const end = n + 1 < starts.length ? starts[n + 1] : buf.length
  try {
    all += zstdDecompressSync(buf.subarray(starts[n], end)).toString('utf8')
    okFrames++
  } catch {
    all += '\n'
  }
}
console.log(`  解压成功帧 = ${okFrames}`)

const lines = all.split(/\r?\n/).filter((l) => l.trim())
console.log(`  总行数     = ${lines.length}`)

const key = '"agentPreset"'
const hits = []
lines.forEach((l, i) => {
  if (!l.includes(key)) return
  let preset = '(parse failed)'
  let type = '?'
  try {
    const o = JSON.parse(l)
    type = o.type ?? '?'
    preset = findPreset(o) ?? '(none)'
  } catch {}
  hits.push({ line: i + 1, type, preset })
})
console.log(`  含 agentPreset 的行 = ${hits.length}`)
for (const h of hits) console.log(`    第${String(h.line).padStart(6)}行  type=${String(h.type).padEnd(14)} preset=${h.preset}`)
const distinct = [...new Set(hits.map((h) => h.preset))]
console.log(`  出现的不同 preset 值 = ${distinct.join(' , ')}`)

function findPreset(node, depth = 0) {
  if (depth > 6 || node === null || typeof node !== 'object') return undefined
  if (typeof node.agentPreset === 'string') return node.agentPreset
  for (const v of Object.values(node)) {
    const r = findPreset(v, depth + 1)
    if (r !== undefined) return r
  }
  return undefined
}
