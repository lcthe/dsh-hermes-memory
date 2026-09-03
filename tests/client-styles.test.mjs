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
