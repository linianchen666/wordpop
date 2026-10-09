const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(process.execPath, ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  path.join(__dirname, 'fixtures/ambient-window.cjs')], { env, encoding: 'utf8', timeout: 45000 });
process.stdout.write(result.stdout || '');
if (result.status !== 0) process.stderr.write(result.stderr || '');
assert.ifError(result.error);
assert.strictEqual(result.status, 0, 'Independent pill must work with the normal review card');
assert.ok(result.stdout.includes('Ambient Chromium checks passed:'));
