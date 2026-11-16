// Read a session's ACTUAL tool set and persona from its own log, and diff two sessions.
//
// Why this works: the session records `request/header`, whose `data.header.tools[]` is the
// exact tool array handed to the model for that step — names, descriptions and schemas. So
// "does this preset mount subagent?" is answerable from disk, with no GUI and no RPC, and no
// reliance on the model describing itself.
//
// Companion evidence: `system/message` carries the persona, and the `session` record carries
// `agentPreset` — so one command answers all three: which preset, which persona, which tools.
//
// Usage: node session-tools.mjs <sessionA> [sessionB]
//   one file  -> print preset, persona head, tool count, sorted tool names
//   two files -> additionally print the A/B diff (that is how a preset's delta is proven)

import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

function read(file) {
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
  let preset = null
  let persona = null
  let tools = null
  for (const l of all.split(/\r?\n/)) {
    if (!l.trim()) continue
    let o
    try { o = JSON.parse(l) } catch { continue }
    if (o.type === 'session') preset = o.agentPreset ?? preset
    else if (o.type === 'system/message' && persona === null) {
      const c = o.data?.message?.content
      if (Array.isArray(c)) persona = c.map((x) => x?.text ?? '').join('')
    } else if (o.type === 'request/header') {
      const t = o.data?.header?.tools
      if (Array.isArray(t)) tools = t.map((x) => x?.name).filter(Boolean)
    }
  }
  return { preset, persona, tools }
}

const [fileA, fileB] = process.argv.slice(2)
if (!fileA) throw new Error('usage: node session-tools.mjs <sessionA> [sessionB]')

const A = read(fileA)
const describe = (label, r) => {
  console.log(`  ${label}`)
  console.log(`    preset(会话头=创建时的值) = ${r.preset ?? '(未记录)'}`)
  console.log(`      ⚠️ 空白会话在 UI 里切过 preset 的话，这个字段**不会变** —— 实际挂了什么看下面两行`)
  const p = (r.persona ?? '').replace(/\s+/g, ' ')
  const kind = /independent verification agent/i.test(p) ? '验证者（independent verification agent）' : /coding agent/i.test(p) ? '编码代理（coding agent）' : '(未知)'
  console.log(`    persona     = ${kind}`)
  console.log(`      ${JSON.stringify(p.slice(0, 90))}`)
  if (!r.tools) { console.log('    tools       = (这条会话没有 request/header 记录 —— 还没发过消息？)'); return }
  console.log(`    tools       = ${r.tools.length} 个`)
  const deleg = r.tools.filter((n) => /subagent|workflow|ralph/i.test(n))
  console.log(`    委派类      = ${deleg.length} 个 [${deleg.join(', ')}]`)
  console.log(`    全部        = [${[...r.tools].sort().join(', ')}]`)
}
describe('A: ' + fileA.split(/[\\/]/).slice(-2)[0], A)

if (fileB) {
  const B = read(fileB)
  describe('B: ' + fileB.split(/[\\/]/).slice(-2)[0], B)
  if (A.tools && B.tools) {
    const sa = new Set(A.tools)
    const sb = new Set(B.tools)
    const onlyA = [...sa].filter((x) => !sb.has(x)).sort()
    const onlyB = [...sb].filter((x) => !sa.has(x)).sort()
    console.log('')
    console.log(`  ===== A/B 差集 =====`)
    console.log(`    仅 A 有 (${onlyA.length}) = [${onlyA.join(', ')}]`)
    console.log(`    仅 B 有 (${onlyB.length}) = [${onlyB.join(', ')}]`)
    console.log(`    数量 ${A.tools.length} vs ${B.tools.length}   →  ${A.tools.length - B.tools.length}`)
  }
}
