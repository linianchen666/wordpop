const assert = require("assert");
const path = require("path");
const { spawnSync } = require("child_process");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(
  process.execPath,
  [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    path.join(__dirname, "fixtures", "android-reveal.cjs"),
  ],
  { env, encoding: "utf8", timeout: 30000 },
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr && result.status !== 0) process.stderr.write(result.stderr);
assert.ifError(result.error);
assert.equal(result.status, 0);
