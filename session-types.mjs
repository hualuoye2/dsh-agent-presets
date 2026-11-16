// First look at any v4/v3 session file: record-type histogram + the keys each type carries.
//
// Why: before asking "does this session have tool X", you have to know which record would
// say so. Printing the vocabulary beats guessing a needle — and a needle is exactly how the
// instruction-budget check fooled itself (it matched AGENTS.md's own prose).
//
// Usage: node session-types.mjs <session.v*.jsonl.zstd> [maxTypes]

import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const [file, maxArg] = process.argv.slice(2)
if (!file) throw new Error('usage: node session-types.mjs <session.v*.jsonl.zstd> [maxTypes]')
const maxTypes = Number(maxArg ?? 40)

const buf = readFileSync(file)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []
for (let i = 0; ; ) {
  const k = buf.indexOf(MAGIC, i)
  if (k < 0) break
  starts.push(k)
  i = k + 4
}
let all = ''
for (let n = 0; n < starts.length; n++) {
  const end = n + 1 < starts.length ? starts[n + 1] : buf.length
  try { all += zstdDecompressSync(buf.subarray(starts[n], end)).toString('utf8') } catch { all += '\n' }
}

const types = new Map()
for (const l of all.split(/\r?\n/)) {
  if (!l.trim()) continue
  let o
  try { o = JSON.parse(l) } catch { continue }
  const t = o.type ?? '?'
  const e = types.get(t) ?? { n: 0, keys: new Set() }
  e.n++
  for (const k of Object.keys(o)) e.keys.add(k)
  if (o.data && typeof o.data === 'object') for (const k of Object.keys(o.data)) e.keys.add(`data.${k}`)
  types.set(t, e)
}
console.log(`  帧=${starts.length}  记录类型=${types.size}`)
for (const [t, e] of [...types.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, maxTypes)) {
  console.log(`  ${String(e.n).padStart(5)}  ${t.padEnd(26)} keys=[${[...e.keys].join(', ')}]`)
}
