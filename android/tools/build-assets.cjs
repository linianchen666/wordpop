const fs = require("fs"),
  path = require("path"),
  { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "../.."),
  out = path.join(root, "android/app/src/main/assets");
const vocab = new Map();
const ranks = require("../../src/data/wordlists/frequency.json");
for (const list of ["cet4", "cet6", "kaoyan"])
  for (const word of require("../../src/data/wordlists/" + list + ".json")
    .words) {
    const existing = vocab.get(word.word);
    if (existing) existing.wordlists.push(list);
    else vocab.set(word.word, { ...word, wordlists: [list] });
  }
const rank = new Map(ranks.map((word, index) => [word, index]));
fs.writeFileSync(
  path.join(out, "vocabulary.json"),
  JSON.stringify(
    [...vocab.values()].sort(
      (a, b) =>
        (rank.get(a.word) ?? 1e9) - (rank.get(b.word) ?? 1e9) ||
        a.word.localeCompare(b.word),
    ),
  ),
);
const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "--yes",
    "--package",
    "esbuild@0.25.0",
    "esbuild",
    "android/core-entry.js",
    "--bundle",
    "--platform=browser",
    "--format=iife",
    "--global-name=WordPopCore",
    "--outfile=android/app/src/main/assets/core.js",
  ],
  { cwd: root, stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status || 1);
console.log("Android vocabulary: " + vocab.size + " words");
