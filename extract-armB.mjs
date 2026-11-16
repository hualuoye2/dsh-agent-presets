// Extract Arm B's verdict and, first and foremost, audit what it WROTE.
//
// It was told "do not modify the code under test". It used write x4 and edit x2
// anyway. Before reading its conclusion, establish whether the artifact under
// test was touched — a verifier that edits its own subject invalidates itself.

import { readFileSync } from 'node:fs'

const raw = JSON.parse(
  readFileSync('D:/deepseek/.agent-presets/_armB_page.json', 'utf8').replace(/^\uFEFF/, ''),
)
const events = raw.map((r) => r.event).filter(Boolean)
const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, '.')

console.log('════ 1) 它写/改了什么（审计） ════')
const mutating = new Set(['write', 'edit', 'str_replace_editor', 'notebook_edit'])
for (const e of events) {
  if (e.type !== 'tool/call') continue
  const d = e.data ?? {}
  const name = d.name ?? d.tool ?? '?'
  if (!mutating.has(name)) continue
  const a = d.arguments ?? d.args ?? {}
  const target = a.file_path ?? a.path ?? a.notebook_path ?? '(no path field)'
  console.log(`  ${name}  ->  ${ascii(target)}`)
}

console.log('')
console.log('════ 2) 被测文件是否被改动 ════')
const suspect = 'check_three_features.py'
const touched = events.some((e) => {
  if (e.type !== 'tool/call') return false
  const d = e.data ?? {}
  if (!mutating.has(d.name ?? d.tool ?? '')) return false
  const a = d.arguments ?? d.args ?? {}
  return String(a.file_path ?? a.path ?? '').includes(suspect)
})
console.log(`  ${suspect} 被 write/edit 触碰: ${touched}`)

console.log('')
console.log('════ 3) 它的最终答复 ════')
const assistant = events.filter((e) => e.type === 'assistant/message')
const texts = assistant
  .flatMap((e) => e.data?.message?.content ?? [])
  .filter((c) => c.type === 'text')
  .map((c) => c.text)
const final = texts[texts.length - 1] ?? '(none)'
console.log(final)

console.log('')
console.log('════ 4) 它加载了什么 skill ════')
for (const e of events) {
  if (e.type !== 'tool/call') continue
  const d = e.data ?? {}
  const name = d.name ?? d.tool ?? ''
  if (name !== 'skill') continue
  console.log('  skill: ' + ascii(JSON.stringify(d.arguments ?? d.args ?? {})))
}
