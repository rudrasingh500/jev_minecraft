import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
test('connection refusal before plugins load exits cleanly without calling Jev', async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['src/main.js'], {
    env: { ...process.env, TYPESAFE_API_KEY: 'test-only', MC_HOST: '127.0.0.1', MC_PORT: '1', MC_AUTH: 'offline' },
    timeout: 5000
  });
  assert.match(stdout, /connection_error/);
  assert.match(stdout, /"requests":0/);
  assert.doesNotMatch(stdout + stderr, /TypeError|test-only/);
});
