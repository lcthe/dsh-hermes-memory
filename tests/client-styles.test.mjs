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

  for (const className of ['group', 'groupHeader', 'groupTitle', 'groupDescription', 'rows', 'rowCopy', 'nested']) {
    assert.match(component, new RegExp(`css\\.${className}\\b`))
  }
  assert.match(css, /max-width:\s*720px/)
  assert.match(css, /@media\s*\(max-width:\s*560px\)/)
  assert.match(css, /--dsw-alias-label-tertiary/)
  assert.doesNotMatch(css, /box-shadow:/)
})
