// Fault injector. Writes a MODIFIED COPY; never touches the source.
// Every mode asserts its own edit landed (count-matched replacement) and that the
// output differs from the input, then re-reads and prints the injected line.
// Usage: node inject.mjs <src> <dst> <mode>
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const [src, dst, mode] = process.argv.slice(2)
if (!src || !dst || !mode) throw new Error('usage: node inject.mjs <src> <dst> <mode>')
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex').toUpperCase()

const text = readFileSync(src, 'utf8')
let out = null
let what = ''

const countOf = (h, n) => h.split(n).length - 1

if (mode === 'dup-verify-string') {
  out = text + '\n# injected fault: preset-verify mentioned again\n'
  what = 'append a line containing preset-verify'
} else if (mode === 'rename-128k-string') {
  const n = countOf(text, '- id: preset-standard-128k')
  if (n !== 1) throw new Error(`expected 1 occurrence to rename, found ${n}`)
  out = text.replace('- id: preset-standard-128k', '- id: preset-standard-64k')
  what = 'rename row id preset-standard-128k -> preset-standard-64k'
} else if (mode === 'rename-verify-row') {
  const n = countOf(text, '- id: preset-verify')
  if (n !== 1) throw new Error(`expected 1 occurrence to rename, found ${n}`)
  out = text.replace('- id: preset-verify', '- id: preset-verify-renamed')
  what = 'rename row id preset-verify -> preset-verify-renamed'
} else if (mode === 'tool-subagent-into-verify') {
  // preset-verify's plugins list runs to EOF; append at the same indentation (10 spaces for "- id:")
  const tail = '\n          - id: tool-subagent\n            name: \'@deepseek-ai/dsh-tool-subagent\'\n'
  out = text.replace(/\n?$/, '\n') + tail
  what = 'append a tool-subagent plugin entry to the END of preset-verify plugins'
} else if (mode === 'tool-subagent-into-128k') {
  const anchor = '- id: agent-preset-registry'
  const n = countOf(text, anchor)
  if (n !== 1) throw new Error(`anchor ${anchor} appears ${n} times`)
  out = text.replace(anchor, "          - id: tool-subagent\n            name: '@deepseek-ai/dsh-tool-subagent'\n" + anchor)
  what = 'insert an EXTRA tool-subagent plugin entry into preset-standard-128k only'
} else {
  throw new Error(`unknown mode ${mode}`)
}

writeFileSync(dst, out, 'utf8')

// ---- the injector must prove IT worked ----
const shaSrc = sha(src)
const shaDst = sha(dst)
console.log(`MODE                 = ${mode}`)
console.log(`WHAT                 = ${what}`)
console.log(`SRC                  = ${src}`)
console.log(`DST                  = ${dst}`)
console.log(`SHA256_SRC           = ${shaSrc}`)
console.log(`SHA256_DST           = ${shaDst}`)
console.log(`DST_DIFFERS_FROM_SRC = ${shaSrc !== shaDst}`)
if (shaSrc === shaDst) throw new Error('injection did not change the file')
const back = readFileSync(dst, 'utf8')
console.log(`BYTES_SRC            = ${Buffer.byteLength(text, 'utf8')}  BYTES_DST = ${Buffer.byteLength(back, 'utf8')}`)
const needles = {
  'dup-verify-string': 'preset-verify mentioned again',
  'rename-128k-string': '- id: preset-standard-64k',
  'rename-verify-row': '- id: preset-verify-renamed',
  'tool-subagent-into-verify': "- id: tool-subagent\n            name: '@deepseek-ai/dsh-tool-subagent'\n",
  'tool-subagent-into-128k': "- id: tool-subagent\n            name: '@deepseek-ai/dsh-tool-subagent'\n",
}[mode]
console.log(`INJECTED_LITERAL_PRESENT_IN_DST = ${back.includes(needles)}`)
const at = back.indexOf(needles)
console.log(`INJECTED_LITERAL_LINE = ${at < 0 ? 'NOT FOUND' : back.slice(0, at).split('\n').length}`)
if (!back.includes(needles)) throw new Error('injected literal not found in the copy')
console.log(`INJECTOR_VERDICT     = INJECTION_CONFIRMED`)
