import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, readFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createPersistence } from '../lib/persistence.js';

test('saving retries a transient Windows file lock without losing queued records', async t => {
  mkdirSync('tmp', { recursive: true });
  const file = path.resolve('tmp', `lock-test-${randomUUID()}.json`);
  t.after(() => unlinkSync(file));
  let attempts = 0;
  const save = createPersistence(file, { rename(from, to) {
    attempts++;
    if (attempts < 3) { const e = new Error('File temporarily locked'); e.code = 'EPERM'; throw e; }
    renameSync(from, to);
  } });
  await Promise.all([save({ audit: ['first'] }), save({ audit: ['first', 'second'] })]);
  assert.ok(attempts >= 4, 'both queued saves succeed after the injected lock releases');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { audit: ['first', 'second'] });
});
