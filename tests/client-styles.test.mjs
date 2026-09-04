import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const cssPath = new URL('../src/client/memory-settings.module.css', import.meta.url)

test('uses DSH theme tokens for readable settings text', async () => {
  const css = await readFile(cssPath, 'utf8')

  assert.match(css, /color: var\(--dsw-alias-label-secondary\)/)
  assert.match(css, /color: var\(--dsw-alias-label-primary\)/)
  assert.doesNotMatch(css, /--dsh-fg-(?:primary|secondary)/)
})

test('uses native settings groups and responsive layout rules', async () => {
  const [component, css] = await Promise.all([
    readFile(new URL('../src/client/MemorySettings.tsx', import.meta.url), 'utf8'),
    readFile(cssPath, 'utf8'),
  ])

  for (const className of ['group', 'groupHeader', 'groupTitle', 'rows', 'rowCopy', 'nested']) {
    assert.match(component, new RegExp(`css\\.${className}\\b`))
  }
  assert.match(css, /max-width:\s*720px/)
  assert.match(css, /@media\s*\(max-width:\s*560px\)/)
  assert.match(css, /--dsw-alias-label-tertiary/)
  assert.doesNotMatch(css, /box-shadow:/)
})

test('renders accessible toggles with DSH switch visuals', async () => {
  const [component, css] = await Promise.all([
    readFile(new URL('../src/client/MemorySettings.tsx', import.meta.url), 'utf8'),
    readFile(cssPath, 'utf8'),
  ])

  assert.match(component, /css\.switch\b/)
  assert.match(component, /css\.switchTrack\b/)
  assert.match(component, /css\.switchThumb\b/)
  assert.match(css, /input:checked \+ \.switchTrack/)
  assert.match(css, /input:focus-visible/)
  assert.match(css, /--dsw-alias-state-success-primary/)
})

test('uses native settings cards and avoids row-level dividers', async () => {
  const [component, css] = await Promise.all([
    readFile(new URL('../src/client/MemorySettings.tsx', import.meta.url), 'utf8'),
    readFile(cssPath, 'utf8'),
  ])

  assert.match(component, /css\.groupDescription\b/)
  assert.match(component, /aria-expanded=\{open\}/)
  assert.match(component, /css\.chevron\b/)
  assert.doesNotMatch(component, /css\.captureNote|css\.injectionNote|css\.reviewNote/)
  assert.doesNotMatch(css, /\.row,\s*\.field\s*\{[\s\S]*border-bottom:/)
  assert.match(css, /\.group\s*\{[\s\S]*border:\s*1px solid var\(--dsw-alias-border-l2\)/)
  assert.match(css, /\.group\s*\{[\s\S]*border-radius:\s*12px/)
  assert.match(css, /\.groupBody\s*\{[\s\S]*border-top:\s*1px solid var\(--dsw-alias-border-l2\)/)
  assert.match(css, /\.rows[\s\S]*gap:\s*8px/)
  assert.match(css, /\.nested[\s\S]*gap:\s*8px/)
  assert.match(css, /\.row,[\s\S]*\.field[\s\S]*box-sizing:\s*border-box/)
  assert.match(css, /\.row,[\s\S]*\.field[\s\S]*padding:\s*6px 0/)
})

test('exposes standing context controls in the native settings card', async () => {
  const component = await readFile(new URL('../src/client/MemorySettings.tsx', import.meta.url), 'utf8')

  assert.match(component, /standingTitle/)
  assert.match(component, /standingContextEnabled/)
  assert.match(component, /standingMaxEntries/)
  assert.match(component, /standingMaxChars/)
})

test('exposes consolidation controls in a collapsible settings card', async () => {
  const component = await readFile(new URL('../src/client/MemorySettings.tsx', import.meta.url), 'utf8')
  assert.match(component, /consolidationTitle/)
  assert.match(component, /automaticConsolidation/)
  assert.match(component, /consolidationThresholdChars/)
  assert.match(component, /consolidationTargetChars/)
})

test('uses native DSH input visuals for numeric settings', async () => {
  const css = await readFile(cssPath, 'utf8')

  assert.match(css, /\.field input\[type='number'\][\s\S]*height:\s*32px/)
  assert.match(css, /\.field input\[type='number'\][\s\S]*border-radius:\s*8px/)
  assert.match(css, /\.field input\[type='number'\][\s\S]*var\(--dsw-alias-bg-layer-1\)/)
  assert.match(css, /\.field input\[type='number'\][\s\S]*var\(--dsw-alias-brand-primary\)/)
  assert.match(css, /-webkit-inner-spin-button[\s\S]*-webkit-appearance:\s*none/)
  assert.match(css, /appearance:\s*textfield/)
})
