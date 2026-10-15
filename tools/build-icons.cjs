// Generated image -> platform sizes; all resampling uses the same master artwork.
// Install ImageMagick (magick) to regenerate. Generated assets are checked in.
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const root = path.join(__dirname, "..");
const source = path.join(root, "assets/brand/wordpop-source.png");
function convert(args, out) {
  fs.mkdirSync(path.dirname(path.join(root, out)), { recursive: true });
  execFileSync("magick", [source, ...args, path.join(root, out)], {
    stdio: "inherit",
  });
}
convert(["-resize", "512x512"], "assets/icon.png");
convert(
  ["-define", "icon:auto-resize=256,128,64,48,32,24,16"],
  "assets/icon.ico",
);
convert(["-resize", "32x32"], "assets/tray-icon.png");
convert(["-resize", "16x16"], "assets/tray-icon-16.png");
convert(["-resize", "32x32"], "assets/tray-icon-paused.png");
for (const [density, size] of Object.entries({
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
}))
  convert(
    ["-resize", `${size}x${size}`],
    `android/app/src/main/res/mipmap-${density}/ic_launcher.png`,
  );
convert(
  [
    "-resize",
    "328x328",
    "-background",
    "none",
    "-gravity",
    "center",
    "-extent",
    "432x432",
  ],
  "android/app/src/main/res/drawable-nodpi/launcher_foreground.png",
);
convert(
  ["-resize", "192x192"],
  "android/app/src/main/res/drawable/wordpop.png",
);

convert(["-resize", "64x64"], "android/app/src/main/assets/brand.png");
