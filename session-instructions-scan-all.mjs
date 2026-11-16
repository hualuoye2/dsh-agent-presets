// Find which session(s) received a given piece of AGENTS.md content, and how many bytes
// of workspace instructions actually arrived.
//
// The point: after editing AGENTS.md, the only sessions that carry the NEW text are those
// that took an instruction injection afterwards. Comparing their delivered byte counts —
// and whether a truncation notice came with them — is a direct A/B on the instruction
// budget, using the app's own sessions instead of a CLI probe.
//
// Usage: node session-instructions-scan-all.mjs <needle> [needle2 ...]

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { homedir } from 'node:os'

const needles = process.argv.slice(2)
if (!needles.length) throw new Error('usage: node session-instructions-scan-all.mjs <needle> [...]')

const root = join(homedir(), '.dsh', 'sessions')
const FILE_RE = /^session\.v(\d+)\.jsonl\.zstd$/
const files = []
;(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (FILE_RE.test(e.name)) files.push(p)
  }
})(root)

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
function frames(file) {
  const buf = readFileSync(file)
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
    try { all += zstdDecompressSync(buf.subarray(starts[n], end)).toString('utf8') } catch {}
  }
  return all
}

const rows = []
for (const f of files) {
  let all
  try { all = frames(f) } catch { continue }
  const id = f.split(/[/\\]/).slice(-2)[0]
  const hits = needles.filter((n) => all.includes(n))
  if (!hits.length) continue

  // instruction blobs in this session
  const blobs = []
  for (const line of all.split(/\r?\n/)) {
    if (!line.trim()) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    const content = (o?.data?.message ?? o?.data)?.content
    if (!Array.isArray(content)) continue
    for (const c of content) {
      if (typeof c?.text === 'string' && /workspace instructions/i.test(c.text)) {
        blobs.push({ bytes: Buffer.byteLength(c.text, 'utf8'), trunc: /instruction budget|truncated/i.test(c.text) })
      }
    }
  }
  rows.push({ id, mtime: statSync(f).mtimeMs, hits, blobs })
}
rows.sort((a, b) => b.mtime - a.mtime)

console.log(`扫了 ${files.length} 个会话；含目标内容的 ${rows.length} 个\n`)
for (const r of rows) {
  console.log(`  ${r.id}   最后写入 ${new Date(r.mtime).toLocaleTimeString('sv-SE')}`)
  console.log(`    命中: ${r.hits.join(' , ')}`)
  const ws = r.blobs.filter((b) => b.bytes > 1000)
  for (const b of ws) console.log(`    工作区指令 ${b.bytes} 字节   截断通知=${b.trunc}`)
  const big = Math.max(0, ...ws.map((b) => b.bytes))
  if (big) console.log(`    → 最大实收 ${big} 字节${ws.some((b) => b.trunc) ? '  ⚠️ 含截断' : '  ✅ 无截断'}`)
  console.log('')
}
