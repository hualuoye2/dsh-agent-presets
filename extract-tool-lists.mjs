// Final extractor: read ONLY the records that carry the composition's own output.
//
// The first attempt walked every string in the tree and was contaminated by the
// injected AGENTS.md system reminder (33k chars of prose that mentions
// subagent / workflow / ralph). Record shape, learned by inspection:
//
//   rec.event.type === 'system/message'    -> the composed system prompt; the
//                                             preset's persona lands here
//   rec.event.type === 'assistant/message' -> the model's own answer, i.e. the
//                                             observable tool list
//
// Printing is kept ASCII-only where it matters: the console mangles UTF-8, and a
// mojibake reading must never be mistaken for a data problem (AGENTS.md rule 6).

// NOTE: the two `_page-*.json` inputs are NOT checked in. They were 337 KB and
// 361 KB of raw session dumps, deleted after the probe to keep the repo small.
// Regenerate them first (see the recipe in AGENTS.md section 1.6):
//   1. session/prompt each session with the tool-list question, wait, then
//   2. session/page with throughSeq at or below the cursor, and write the
//      records array to .agent-presets/_page-<preset>.json.
// The two probe sessions were created with agentPreset=verify and
// agentPreset=standard on the same throwaway instance.

import { readFileSync, existsSync } from 'node:fs'

const files = {
  verify: 'D:/deepseek/.agent-presets/_page-verify.json',
  standard: 'D:/deepseek/.agent-presets/_page-standard.json',
}

// Fail loudly and ACTIONABLY when the inputs are absent. They are gitignored
// session dumps (5 MB+) deleted after each probe, so "file not found" is the
// normal post-cleanup state — and a bare ENOENT stack trace would read as
// "this tool is broken" rather than "regenerate the probe first".
const absent = Object.entries(files).filter(([, p]) => !existsSync(p))
if (absent.length > 0) {
  console.log('输入缺失，无法判定（这不是 preset 的问题）：')
  for (const [name, p] of absent) console.log(`  ${name}: ${p}`)
  console.log('')
  console.log('先按 skill `verify-agent-presets` 重跑挂载探针，把两个会话的')
  console.log('session/page 记录写成上面两个文件，再运行本脚本。')
  process.exit(2)
}

// The persona line our preset replaces — ASCII, so no console-encoding doubt.
const MARKER = 'independent verification agent'
const SHIPPED_MARKER = 'coding agent powered by'

// Tools that exist ONLY while the `delegation` group is mounted.
const DELEGATION = [
  'subagent_codex',
  'subagent_claude_code',
  'subagent_fork',
  'subagent',
  'workflow',
  'ralph',
  'list_agents',
  'send_message',
  'interrupt_agent',
]

const results = {}
for (const [name, file] of Object.entries(files)) {
  const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  const events = raw.map((r) => r.event).filter(Boolean)

  const systemText = events
    .filter((e) => e.type === 'system/message')
    .flatMap((e) => e.data?.message?.content ?? [])
    .map((c) => c.text ?? '')
    .join('\n')

  const assistantText = events
    .filter((e) => e.type === 'assistant/message')
    .flatMap((e) => e.data?.message?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n')

  // Presence is tested against the ASSISTANT ANSWER only — that is the tool set
  // the model actually had.
  const answered = DELEGATION.filter((t) => new RegExp(`(^|[^a-z_])${t}([^a-z_]|$)`, 'm').test(assistantText))

  // Machine-count the tool-name lines. The published baseline ("verify = 38
  // tools, standard = 44") is a HAND count, and a hand count ages silently —
  // so print the machine count beside it on every run and let the two disagree
  // loudly instead of trusting the prose.
  const toolLines = assistantText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[a-z][a-z0-9_]*$/.test(l))

  results[name] = {
    hasVerifyPersona: systemText.includes(MARKER),
    hasShippedPersona: systemText.includes(SHIPPED_MARKER),
    answered,
    assistantText,
    toolLines,
  }

  console.log(`════════ ${name} ════════`)
  console.log(`  system prompt 含 verify persona  ("${MARKER}") : ${results[name].hasVerifyPersona}`)
  console.log(`  system prompt 含 出厂 persona    ("${SHIPPED_MARKER}") : ${results[name].hasShippedPersona}`)
  console.log(`  助手答案里出现的委派类工具: ${answered.length ? answered.join(', ') : '(一个都没有)'}`)
  console.log(`  工具计数（机器数）= ${toolLines.length}`)
  console.log('  助手答案原文:')
  console.log(
    assistantText
      .split('\n')
      .map((l) => '    | ' + l.replace(/[^\x20-\x7e]/g, '?'))
      .join('\n'),
  )
  console.log('')
}

const v = results.verify
const s = results.standard
// Published baselines, kept here so a drift shows up as a FAIL instead of as
// prose nobody re-reads. If a bundle adds or removes a tool these will fire.
//
// 2026-10-06: was 38 — a HAND count that was simply wrong. Machine count is 37,
// and it is independently derivable: standard 44 − 7 delegation tools = 37. The
// prose in AGENTS.md and skill `verify-agent-presets` now says 37 too; if you
// change one, change all three, and let this assertion police it.
const DOC_VERIFY = 37
const DOC_STANDARD = 44
const checks = [
  ['verify 会话的系统提示带上了我们的 persona', v.hasVerifyPersona === true],
  ['verify 会话没有出厂 persona', v.hasShippedPersona === false],
  ['standard 会话带出厂 persona（对照活着）', s.hasShippedPersona === true],
  ['standard 会话没有我们的 persona', s.hasVerifyPersona === false],
  ['verify 的答案里没有任何委派工具', v.answered.length === 0],
  ['standard 的答案里有委派工具', s.answered.length > 0],
  [`verify 工具数与文档一致 (${DOC_VERIFY})`, v.toolLines.length === DOC_VERIFY],
  [`standard 工具数与文档一致 (${DOC_STANDARD})`, s.toolLines.length === DOC_STANDARD],
  ['两者差集 = delegation 组大小', s.toolLines.length - v.toolLines.length === 7],
]

console.log('════════ 判定 ════════')
console.log(`  机器计数：verify=${v.toolLines.length}  standard=${s.toolLines.length}  差=${s.toolLines.length - v.toolLines.length}`)
console.log(`  文档基线：verify=${DOC_VERIFY}  standard=${DOC_STANDARD}  差=7`)
let bad = 0
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) bad++
}
console.log('')
console.log(bad === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${bad})`)
process.exit(bad === 0 ? 0 : 1)
