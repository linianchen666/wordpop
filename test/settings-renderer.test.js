// Exercise the real HTML, preload, IPC, database import and settings save in
// Chromium. Node-only tests cannot detect a missing DOM control during init.
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(process.execPath, [
  '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  path.join(__dirname, 'fixtures', 'settings-window.cjs')
], { env, encoding: 'utf8', timeout: 45000 });
process.stdout.write(result.stdout || '');
if (result.status !== 0) process.stderr.write(result.stderr || '');
assert.ifError(result.error);
assert.strictEqual(result.status, 0, 'Settings window must initialize and save');
assert.ok(result.stdout.includes('Settings Chromium test passed:'), 'Complete the save and reload checks');
