// List the children of a directory inside an Electron app.asar.
//
// Why a file instead of `node -e`: PowerShell 5.1 mangles quotes on the way to a native
// executable — single-quoted JS arrives with its inner quotes stripped, so the eval dies
// with "SyntaxError: Invalid or unexpected token". Writing the script sidesteps it
// entirely (the workspace already records this class of failure).
//
// Usage: node asar-list.mjs <app.asar> <member-dir-path> [depth]

import { readFileSync } from 'node:fs'

const [file, dir, depthArg] = process.argv.slice(2)
if (!file || !dir) throw new Error('usage: node asar-list.mjs <app.asar> <member-dir-path> [depth]')
const maxDepth = Number(depthArg ?? 1)

const buf = readFileSync(file)
const jsonLen = buf.readUInt32LE(12)
const header = JSON.parse(buf.subarray(16, 16 + jsonLen).toString('utf8'))

let node = header
for (const seg of dir.split('/').filter(Boolean)) {
  node = node?.files?.[seg]
  if (!node) throw new Error(`no such member: ${dir} (failed at "${seg}")`)
}

function walk(n, prefix, depth) {
  for (const [name, child] of Object.entries(n.files ?? {})) {
    const p = prefix ? `${prefix}/${name}` : name
    if (child.files) {
      console.log(`  ${p}/   (${Object.keys(child.files).length} 项)`)
      if (depth < maxDepth) walk(child, p, depth + 1)
    } else {
      console.log(`  ${p}   ${child.size} B`)
    }
  }
}
console.log(`== ${dir} (depth ${maxDepth}) ==`)
walk(node, '', 1)
