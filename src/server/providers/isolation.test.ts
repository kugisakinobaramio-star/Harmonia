import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runProviderTask,
  recordProviderFailure,
  recordProviderSuccess,
  isProviderCircuitOpen,
  getProviderFailureSnapshot,
} from './isolation.ts';

describe('runProviderTask', () => {
  it('returns success value within timeout', async () => {
    const result = await runProviderTask('test', async () => 42, 500);
    assert.equal(result.ok, true);
    assert.equal(result.value, 42);
    assert.ok(result.durationMs >= 0);
  });

  it('times out and does not throw', async () => {
    const result = await runProviderTask(
      'slow',
      () => new Promise((resolve) => setTimeout(() => resolve('late'), 800)),
      50,
    );
    assert.equal(result.ok, false);
    assert.match(result.error || '', /timed out/);
    assert.ok(result.durationMs >= 40);
  });

  it('captures thrown errors', async () => {
    const result = await runProviderTask(
      'boom',
      async () => {
        throw new Error('provider exploded');
      },
      300,
    );
    assert.equal(result.ok, false);
    assert.match(result.error || '', /provider exploded/);
  });
});

describe('circuit helper', () => {
  it('opens after repeated failures and closes on success', () => {
    const id = `test-provider-${Date.now()}`;
    assert.equal(isProviderCircuitOpen(id), false);
    for (let i = 0; i < 8; i += 1) recordProviderFailure(id);
    assert.equal(isProviderCircuitOpen(id), true);
    recordProviderSuccess(id);
    assert.equal(isProviderCircuitOpen(id), false);
    const snap = getProviderFailureSnapshot();
    assert.equal(snap[id], undefined);
  });
});
