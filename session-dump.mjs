// Dump every record of a session file compactly: record type + a short payload slice.
//
// Why: a session's own log is the closest thing to a record of what the CLIENT asked
// for. If the GUI passed `agentPreset` explicitly, that shows up here; if it omitted it,
// the stored preset came from the server's roster default.
//
// Usage: node session-dump.mjs <session.v*.jsonl.zstd> [sliceLen]

import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const file = process.argv[2]
const slice = Number(process.argv[3] ?? 200)
if (!file) throw new Error('usage: node session-dump.mjs <session file> [sliceLen]')

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

const lines = all.split(/\r?\n/).filter((l) => l.trim())
console.log(`帧=${starts.length}  行=${lines.length}`)
lines.forEach((l, i) => {
  let type = '?'
  try { type = JSON.parse(l).type ?? '?' } catch {}
  const flat = l.replace(/\s+/g, ' ')
  console.log(`  ${String(i + 1).padStart(3)} ${String(type).padEnd(22)} ${flat.slice(0, slice)}`)
})
