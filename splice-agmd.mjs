// Splice replacement text into AGENTS.md, by `## ` section, with hard assertions.
//
// Why a script instead of many edits: (a) it asserts each target heading is found
// EXACTLY once, so a silent no-op is impossible; (b) the replacement text is read
// from FILES, so Windows backslashes in it can never be mangled by JS string
// escapes (`\t` -> TAB, `\n` -> newline); (c) untouched sections pass through
// byte-for-byte, so the blast radius is exactly the sections named here.
//
// Usage: node splice-agmd.mjs <target.md> <replacementFile> [<replacementFile> ...]
// Each replacement file must begin with the `## ` heading of the section it replaces.

import { readFileSync, writeFileSync } from 'node:fs'

const [, , target, ...replacementFiles] = process.argv
if (!target || replacementFiles.length === 0) {
  console.error('usage: node splice-agmd.mjs <target.md> <replacementFile> [...]')
  process.exit(2)
}

const bytes = (s) => Buffer.byteLength(s, 'utf8')
const raw = readFileSync(target, 'utf8')
const hadBom = raw.charCodeAt(0) === 0xfeff
const lines = raw.replace(/^\uFEFF/, '').split('\n')
const before = bytes(raw.replace(/^\uFEFF/, ''))

// Section boundaries: a `## ` heading starts a section; it runs until the next one.
const starts = []
for (let i = 0; i < lines.length; i++) if (/^##\s+/.test(lines[i])) starts.push(i)

const headingAt = (i) => lines[i]
const sectionRange = (startIdx) => {
  const next = starts.find((s) => s > startIdx)
  return [startIdx, next === undefined ? lines.length : next]
}

const out = [...lines]
// Apply from the BOTTOM up so earlier indices stay valid.
const jobs = []
for (const file of replacementFiles) {
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\n$/, '')
  const newLines = text.split('\n')
  const heading = newLines[0]
  if (!/^##\s+/.test(heading)) throw new Error(`${file}: first line must be a "## " heading, got: ${heading}`)
  const hits = lines.map((l, i) => (l === heading ? i : -1)).filter((i) => i >= 0)
  if (hits.length !== 1) throw new Error(`${file}: heading ${JSON.stringify(heading)} matched ${hits.length} times (want exactly 1)`)
  jobs.push({ file, heading, startIdx: hits[0], newLines })
}

jobs.sort((a, b) => b.startIdx - a.startIdx)
for (const job of jobs) {
  const [from, to] = sectionRange(job.startIdx)
  const oldBytes = bytes(out.slice(from, to).join('\n'))
  const newBytes = bytes(job.newLines.join('\n'))
  console.log(
    `${job.heading.slice(0, 40).padEnd(42)} ${String(oldBytes).padStart(6)} -> ${String(newBytes).padStart(6)}  (${oldBytes - newBytes >= 0 ? '-' : '+'}${Math.abs(oldBytes - newBytes)})`,
  )
  out.splice(from, to - from, ...job.newLines)
}

const result = out.join('\n')
writeFileSync(target, result, 'utf8')
console.log('')
console.log(`总计 ${before} -> ${bytes(result)} 字节  (${before - bytes(result) >= 0 ? '-' : '+'}${Math.abs(before - bytes(result))}，${(100 - (bytes(result) / before) * 100).toFixed(1)}% 缩减)`)
console.log(`BOM 写入前=${hadBom}，写回不带 BOM`)
console.log(`行数 ${lines.length} -> ${out.length}`)
