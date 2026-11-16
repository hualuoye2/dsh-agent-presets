// Check a preset's display metadata the way the roster will read it.
//
// Two failure modes this catches that a visual inspection cannot:
//   1. a UTF-8 BOM (EF BB BF) at the head of the file, which breaks YAML/JSON
//      parsing while looking perfectly normal in a terminal;
//   2. a `description` containing an ASCII colon+space, which silently turns the
//      rest of the line into a nested mapping instead of text.
//
// AGENTS.md rule 6 already warns that Chinese text mangled in a PowerShell
// console is a DISPLAY problem, not a file problem. So this reads bytes and
// re-encodes explicitly rather than trusting what the console showed.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire('C:/Users/常绚/.dsh/profiles/desktop/node_modules/_resolve-anchor.js')
const yaml = require('js-yaml')

const FILES = [
  'D:/deepseek/.agent-presets/verify/preset.yml',
  'D:/deepseek/.agent-presets/verify/agent.cordis.yml',
]

let bad = 0
for (const file of FILES) {
  const buf = readFileSync(file)
  const head = [...buf.subarray(0, 3)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  // An invalid UTF-8 sequence decodes to U+FFFD; none should appear.
  const text = buf.toString('utf8')
  const replacements = (text.match(/\uFFFD/g) ?? []).length
  console.log(`${file}`)
  console.log(`  first bytes      = ${head}${bom ? '   <-- BOM PRESENT' : ''}`)
  console.log(`  bytes            = ${buf.length}`)
  console.log(`  U+FFFD (bad utf8) = ${replacements}`)
  if (bom || replacements) bad++
}

// The metadata file must parse to an object with string name/description.
const meta = yaml.load(readFileSync(FILES[0], 'utf8'))
console.log('')
console.log('preset.yml parsed:')
console.log(`  name        = ${JSON.stringify(meta?.name)}`)
console.log(`  description = ${JSON.stringify(meta?.description)}`)
const metaOk =
  meta && typeof meta === 'object' && typeof meta.name === 'string' && typeof meta.description === 'string'
if (!metaOk) {
  console.log('  <-- FAIL: name and description must both be strings')
  bad++
}
if (typeof meta?.description === 'string' && meta.description.includes(': ')) {
  console.log('  <-- FAIL: description contains an ASCII colon+space')
  bad++
}
// Round-trip: the text must survive a YAML dump/load unchanged, which is what a
// copy or a settings write would do to it.
if (metaOk) {
  const again = yaml.load(yaml.dump(meta))
  if (JSON.stringify(again) !== JSON.stringify(meta)) {
    console.log('  <-- FAIL: metadata does not survive a YAML round-trip')
    bad++
  } else {
    console.log('  round-trip  = identical')
  }
}

console.log('')
console.log(bad === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${bad})`)
process.exit(bad === 0 ? 0 : 1)
