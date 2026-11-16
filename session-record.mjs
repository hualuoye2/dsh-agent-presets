// Print the raw JSON of every record of a given type from a session file (all zstd frames).
//
// Usage: node session-record.mjs <session.v*.jsonl.zstd> <recordType> [maxChars=2000] [maxRecords=3]

import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const [file, wantType, maxArg, nArg] = process.argv.slice(2)
if (!file || !wantType) throw new Error('usage: node session-record.mjs <session.v*.jsonl.zstd> <recordType> [maxChars] [maxRecords]')
const maxChars = Number(maxArg ?? 2000)
const maxRecords = Number(nArg ?? 3)

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

let shown = 0
let total = 0
for (const l of all.split(/\r?\n/)) {
  if (!l.trim()) continue
  let o
  try { o = JSON.parse(l) } catch { continue }
  if (o.type !== wantType) continue
  total++
  if (shown >= maxRecords) continue
  shown++
  const s = JSON.stringify(o, null, 2)
  console.log(`--- ${wantType} #${shown} (${s.length} 字符${s.length > maxChars ? `，下列截到 ${maxChars}` : ''}) ---`)
  console.log(s.slice(0, maxChars))
}
if (!total) console.log(`(没有 ${wantType} 记录)`)
else console.log(`\n共 ${total} 条 ${wantType}，显示 ${shown} 条`)
