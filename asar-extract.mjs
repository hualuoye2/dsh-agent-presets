// Extract one file out of an Electron app.asar by byte range.
//
// asar is a plain concatenation container: an 8-byte preamble, a JSON directory
// (each entry carries `offset` + `size`, offset relative to the data base), then the
// file bytes. So any member can be pulled out without the asar CLI — which matters
// here because `app.asar\dsh\...` is invisible to rg/PowerShell (only Electron's
// patched fs reads inside the archive), yet the bytes are perfectly readable.
//
// Usage: node asar-extract.mjs <app.asar> <member-path>   (prints the file to stdout)

import { readFileSync } from 'node:fs'

const [file, member] = process.argv.slice(2)
if (!file || !member) throw new Error('usage: node asar-extract.mjs <app.asar> <member-path>')

const buf = readFileSync(file)

// Preamble layout (verified against this 115 MB archive):
//   [0..4)  = 4
//   [4..8)  = header pickle size  → file data base = 8 + this
//   [8..12) = header pickle total (json length + 4)
//   [12..16)= json length
//   [16..)  = JSON directory
const assertUint = buf.readUInt32LE(0)
const headerPickleSize = buf.readUInt32LE(4)
const jsonLen = buf.readUInt32LE(12)
if (assertUint !== 4) throw new Error(`not an asar: first uint32 = ${assertUint}, expected 4`)

const header = JSON.parse(buf.subarray(16, 16 + jsonLen).toString('utf8'))
const dataBase = 8 + headerPickleSize

const parts = member.replace(/^[/\\]+/, '').split(/[/\\]+/)
let node = header
for (const p of parts) {
  if (!node || !node.files || !node.files[p]) {
    // Help diagnose typos: list the siblings we do have.
    const sibs = node?.files ? Object.keys(node.files).slice(0, 25) : []
    throw new Error(`member not found: ${member}\n  failed at segment ${JSON.stringify(p)}\n  siblings: ${sibs.join(', ')}`)
  }
  node = node.files[p]
}
if (node.files) throw new Error(`member is a directory, not a file: ${member}`)
if (typeof node.offset !== 'string') throw new Error(`member has no byte offset: ${member}`)

const start = dataBase + Number(node.offset)
const out = buf.subarray(start, start + Number(node.size))
if (out.length !== Number(node.size)) throw new Error(`short read: got ${out.length}, want ${node.size}`)
process.stdout.write(out)
