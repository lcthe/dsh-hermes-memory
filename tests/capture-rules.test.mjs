import assert from 'node:assert/strict'
import test from 'node:test'
import { detectCaptureCandidates } from '../src/core/capture-rules.ts'

test('detects correction, convention, and preference candidates', () => {
  assert.deepEqual(detectCaptureCandidates('不对，应该用 pnpm'), [
    { scope: 'failure', category: 'correction', text: '不对，应该用 pnpm' },
  ])
  assert.deepEqual(detectCaptureCandidates('这个项目使用 pnpm'), [
    { scope: 'project', category: 'convention', text: '这个项目使用 pnpm' },
  ])
  assert.deepEqual(detectCaptureCandidates('以后都用中文回答'), [
    { scope: 'user', category: 'preference', text: '以后都用中文回答' },
  ])
})

test('applies correction priority over convention and preference signals', () => {
  assert.deepEqual(detectCaptureCandidates('项目里以后都用 pnpm'), [
    { scope: 'project', category: 'convention', text: '项目里以后都用 pnpm' },
  ])
  assert.deepEqual(detectCaptureCandidates('不对，这个项目应该用 pnpm'), [
    { scope: 'failure', category: 'correction', text: '不对，这个项目应该用 pnpm' },
  ])
})

test('rejects empty, too-short, and overlong texts', () => {
  assert.deepEqual(detectCaptureCandidates(''), [])
  assert.deepEqual(detectCaptureCandidates('   '), [])
  assert.deepEqual(detectCaptureCandidates('记住'), [])
  assert.deepEqual(detectCaptureCandidates('以后'.repeat(600)), [])
  assert.deepEqual(detectCaptureCandidates('没有信号的一句话'), [])
})