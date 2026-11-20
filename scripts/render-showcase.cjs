// Renders brand/showcase.html frame by frame into brand/orbital-showcase.mp4 (1080p, 30 fps):
//   node scripts/render-showcase.cjs [framesDir]
// Optional: SHOWCASE_STILLS="2,6,9" saves only those moments as PNGs (for a quick look).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const FPS = 30;
const root = path.join(__dirname, "..");
const framesDir = process.argv[2] || fs.mkdtempSync(path.join(require("os").tmpdir(), "orbital-showcase-"));

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto("file://" + path.join(root, "brand", "showcase.html") + "?render=1");
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  const duration = await page.evaluate(() => window.DURATION);
  const grab = (t) => page.evaluate((t) => { window.renderAt(t); return document.getElementById("c").toDataURL("image/jpeg", 0.95); }, t);

  if (process.env.SHOWCASE_STILLS) {
    for (const s of process.env.SHOWCASE_STILLS.split(",").map(Number)) {
      const out = path.join(framesDir, `still-${s}.jpg`);
      fs.writeFileSync(out, Buffer.from((await grab(s)).split(",")[1], "base64"));
      console.log(out);
    }
    await b.close();
    return;
  }
  const total = Math.ceil(duration * FPS);
  for (let f = 0; f < total; f++) {
    fs.writeFileSync(path.join(framesDir, `${String(f).padStart(5, "0")}.jpg`), Buffer.from((await grab(f / FPS)).split(",")[1], "base64"));
    if (f % 150 === 0) console.log(`frame ${f}/${total}`);
  }
  await b.close();
  const out = path.join(root, "brand", "orbital-showcase.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(framesDir, "%05d.jpg"),
    "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: "inherit" });
  console.log(out);
})();
