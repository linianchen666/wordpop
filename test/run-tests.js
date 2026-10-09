// SQLite is compiled for Electron; run each suite in that runtime and isolate
// module-cache/Electron substitutes between suites.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const electron = require('electron');

const files = fs.readdirSync(__dirname).filter(file => file.endsWith('.test.js')).sort();
if (!files.length) throw new Error('No test suites found');

let failures = 0;
for (const file of files) {
  console.log(`\nRunning ${file}`);
  const result = spawnSync(electron, [path.join(__dirname, file)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit'
  });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) failures++;
}

console.log(`\n${files.length - failures}/${files.length} test suites passed.`);
process.exitCode = failures ? 1 : 0;
