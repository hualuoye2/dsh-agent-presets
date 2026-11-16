// Inspect the shape of the session-page records so the extractor can target the
// ASSISTANT's own message instead of every string in the tree.
//
// The first extractor walked all strings and was contaminated by the injected
// AGENTS.md system reminder, whose prose mentions subagent/workflow/ralph. Any
// real tool-list diff must read the assistant record only.

import { readFileSync } from 'node:fs'

const raw = JSON.parse(readFileSync('D:/deepseek/.agent-presets/_page-verify.json', 'utf8').replace(/^\uFEFF/, ''))

console.log(`records = ${raw.length}`)
console.log('')
raw.forEach((rec, i) => {
  const keys = rec && typeof rec === 'object' ? Object.keys(rec) : []
  const type = rec?.type ?? rec?.kind ?? rec?.role ?? '?'
  // A short ASCII-only preview so console encoding cannot confuse the reading.
  const preview = JSON.stringify(rec).replace(/[^\x20-\x7e]/g, '.').slice(0, 260)
  console.log(`[${i}] type=${type} keys=[${keys.join(',')}]`)
  console.log(`     ${preview}`)
})
