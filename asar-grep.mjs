// Find which member file inside an Electron app.asar contains a given string.
//
// app.asar is "8-byte preamble + JSON directory + concatenated file bytes", and each
// directory entry carries `offset` (relative to the data base) + `size`. So a raw byte
// hit can be mapped back to its owning member — which turns an opaque 115 MB archive
// into something greppable. (External rg/PowerShell cannot read inside at all; only
// Electron's patched fs can.)
//
// Usage: node asar-grep.mjs <app.asar> <needle> [maxHits] [contextChars]

import { readFileSync } from 'node:fs'

const [file, needle, maxHitsArg, ctxArg] = process.argv.slice(2)
if (!file || !needle) throw new Error('usage: node asar-grep.mjs <app.asar> <needle> [maxHits] [contextChars]')
const maxHits = Number(maxHitsArg ?? 5)
const ctxLen = Number(ctxArg ?? 400)

const buf = readFileSync(file)
const headerPickleSize = buf.readUInt32LE(4)
const jsonLen = buf.readUInt32LE(12)
const header = JSON.parse(buf.subarray(16, 16 + jsonLen).toString('utf8'))
const dataBase = 8 + headerPickleSize

// Flatten the directory into [absStart, absEnd, memberPath] ranges.
const ranges = []
;(function walk(node, prefix) {
  if (!node || !node.files) return
  for (const [name, child] of Object.entries(node.files)) {
    const p = prefix ? `${prefix}/${name}` : name
    if (child.files) { walk(child, p); continue }
    const start = dataBase + Number(child.offset)
    ranges.push([start, start + Number(child.size), p])
  }
})(header, '')
ranges.sort((a, b) => a[0] - b[0])
console.log(`members = ${ranges.length}   dataBase = ${dataBase}`)

function ownerOf(offset) {
  let lo = 0, hi = ranges.length - 1, best = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (ranges[mid][0] <= offset) { best = ranges[mid]; lo = mid + 1 } else hi = mid - 1
  }
  return best && offset < best[1] ? best : null
}

const nb = Buffer.from(needle, 'utf8')
const hits = []
let i = 0
while (hits.length < maxHits) {
  const k = buf.indexOf(nb, i)
  if (k < 0) break
  hits.push(k)
  i = k + nb.length
}
console.log(`hits = ${hits.length}${hits.length === maxHits ? '+' : ''}`)
for (const at of hits) {
  const owner = ownerOf(at)
  console.log('='.repeat(90))
  console.log(`@${at}  member = ${owner ? owner[2] : '(header/unknown)'}  offsetInMember = ${owner ? at - owner[0] : '?'}`)
  const s = Math.max(0, at - ctxLen)
  const e = Math.min(buf.length, at + ctxLen)
  console.log(buf.subarray(s, e).toString('utf8').replace(/\s+/g, ' '))
}
