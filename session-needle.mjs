// Grep a v4 session file for arbitrary needles, reading EVERY zstd frame.
//
// Why not a plain grep: the file is zstd-compressed and multi-frame, and
// `zstdDecompressSync` on the whole buffer returns only the FIRST frame — so a needle that
// appears later in the session is invisible. This decompresses frame by frame.
//
// Why not `Select-String`: PS 5.1 mangles quotes passed to native commands, and its
// `Split('x')` splits per character (both bit me on 2026-10-07).
//
// Usage: node session-needle.mjs <session.v4.jsonl.zstd> <needle> [needle...]

import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const [file, ...needles] = process.argv.slice(2)
if (!file || !needles.length) throw new Error('usage: node session-needle.mjs <session.v*.jsonl.zstd> <needle> [needle...]')

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
console.log(`  帧=${starts.length}  解出=${all.length} 字符`)
for (const n of needles) {
  let count = 0
  const samples = []
  let i = all.indexOf(n)
  while (i !== -1) {
    count++
    if (samples.length < 3) samples.push(all.slice(Math.max(0, i - 50), i + n.length + 90).replace(/\s+/g, ' '))
    i = all.indexOf(n, i + 1)
  }
  console.log(`  ${JSON.stringify(n)} 出现 ${count} 次`)
  for (const s of samples) console.log(`      …${s}…`)
}
