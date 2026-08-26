import assert from 'node:assert/strict'
import test from 'node:test'
import { InMemoryWatermarkRepository } from '../src/host/watermarks.ts'

test('advances event watermark monotonically', async () => {
  const repository = new InMemoryWatermarkRepository()
  await repository.observeEvent('session-a', 4)
  await repository.observeEvent('session-a', 2)
  assert.equal((await repository.read('session-a'))?.lastEventSeq, 4)
})

test('rejects flush sequence beyond observed event sequence', async () => {
  const repository = new InMemoryWatermarkRepository()
  await assert.rejects(() => repository.observeFlush('session-a', 2), /flush sequence/)
})

test('advances flush watermark without regressing event watermark', async () => {
  const repository = new InMemoryWatermarkRepository()
  await repository.observeEvent('session-a', 5)
  await repository.observeFlush('session-a', 3)
  const value = await repository.read('session-a')
  assert.deepEqual({ event: value?.lastEventSeq, flushed: value?.lastFlushedSeq }, { event: 5, flushed: 3 })
})
