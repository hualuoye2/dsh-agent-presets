// Ask the PRODUCTION discovery code whether `verify` is discovered, and whether
// it is `broken`.
//
// Why this instead of my hand-rolled validator: `discoverPresets` -> `scanRoot`
// -> `compositionProblem` is the exact code the running harness uses to decide a
// preset's health. It is not a test double; it is the real thing, imported from
// the installed package. My own validator only approximated its package-resolution
// step.
//
// Built-in CONTROL: the shipped `standard` preset is definitely loadable. If
// `standard` also reports broken, then THIS PROBE is misconfigured (almost
// certainly a wrong `harnessBase`) and no verdict about `verify` may be read from
// the run. A probe without a control cannot distinguish "the artifact is broken"
// from "my instrument is broken".
//
// Built-in FAULT INJECTION: a scratch preset naming a package that does not
// exist must be reported broken. If it is not, the probe is not actually
// checking package resolution at all.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PKG = 'C:/Users/常绚/.dsh/profiles/node_modules/@deepseek-ai/dsh-agent-presets'
const { discoverPresets } = await import(pathToFileURL(join(PKG, 'lib/index.js')).href)

// "base URL a package name resolves against; the caller's own ctx.baseUrl, which
// is where the installed harness lives."
const harnessBase = pathToFileURL('C:/Users/常绚/.dsh/profiles/node_modules/').href

const SHIPPED = join(PKG, 'presets')
const USER = 'C:/Users/常绚/.dsh/.agent-presets'

console.log('harnessBase = ' + harnessBase)
console.log('shippedRoot = ' + SHIPPED)
console.log('userRoot    = ' + USER)
console.log('')

const roots = [
  { path: SHIPPED, trust: 'system' },
  { path: USER, trust: 'user' },
]

function report(label, presets) {
  console.log(`── ${label} ─────────────────────────────────`)
  for (const p of presets) {
    const broken = p.broken === undefined ? 'OK' : `BROKEN: ${p.broken}`
    console.log(`  ${p.id.padEnd(12)} trust=${String(p.trust).padEnd(6)} ${broken}`)
    if (p.name !== undefined) console.log(`      name        = ${JSON.stringify(p.name)}`)
    if (p.description !== undefined) console.log(`      description = ${JSON.stringify(p.description)}`)
  }
  console.log('')
}

const presets = await discoverPresets(roots, harnessBase)
report('real discovery', presets)

// ── controls ────────────────────────────────────────────────────────────────
const standard = presets.find((p) => p.id === 'standard')
const verify = presets.find((p) => p.id === 'verify')

let failures = 0
const ctl = (ok, label) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures++
}

console.log('── controls (each must PASS, else the probe itself is broken) ──')
ctl(standard !== undefined, 'control: shipped `standard` is discovered')
ctl(standard !== undefined && standard.broken === undefined, 'control: shipped `standard` is loadable (proves harnessBase is right)')
ctl(standard !== undefined && standard.trust === 'system', 'control: `standard` carries trust=system')
ctl(verify !== undefined, 'target: `verify` is discovered in the USER root')
ctl(verify !== undefined && verify.trust === 'user', 'target: `verify` carries trust=user')
ctl(verify !== undefined && verify.name === '独立验证', 'target: `verify` metadata name parses as Chinese text')
console.log('')

// ── fault injection: a preset naming a nonexistent package must be BROKEN ────
const scratch = mkdtempSync(join(tmpdir(), 'preset-probe-'))
const fake = join(scratch, 'injected-broken')
mkdirSync(fake)
writeFileSync(
  join(fake, 'agent.cordis.yml'),
  "- id: nope\n  name: '@deepseek-ai/dsh-tool-THIS-DOES-NOT-EXIST'\n",
)
const injected = await discoverPresets([{ path: scratch, trust: 'user' }], harnessBase)
const injRow = injected.find((p) => p.id === 'injected-broken')
console.log('── fault injection ────────────────────────────────')
console.log(`  injected row: ${injRow === undefined ? '(not discovered)' : (injRow.broken ?? 'NOT BROKEN')}`)
ctl(injRow !== undefined && injRow.broken !== undefined, 'injection: a bogus package name IS reported broken')
rmSync(scratch, { recursive: true, force: true })

console.log('')
console.log(failures === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failures})`)
if (verify !== undefined && verify.broken !== undefined) {
  console.log('')
  console.log('!!! `verify` IS BROKEN — this is the authoritative verdict, and it')
  console.log('!!! explains why the headless session silently fell back to the host')
  console.log('!!! composition instead of composing `verify`.')
}
process.exit(failures === 0 ? 0 : 1)
