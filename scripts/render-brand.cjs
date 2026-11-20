// Renders every brand image in brand/generator.html to brand/*.png:  node scripts/render-brand.cjs
const { chromium } = require("playwright");
const path = require("path");

const ART = [
  ["wordmark-dark", 2400, 1000], ["wordmark-light", 2400, 1000],
  ["o-dark", 2400, 1000], ["o-light", 2400, 1000],
  ["orb-o-dark", 2400, 1000],
  ["icon-dark", 1024, 1024], ["icon-light", 1024, 1024],
  ["banner-dark", 3000, 1000],
];

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  const file = "file://" + path.join(__dirname, "..", "brand", "generator.html");
  for (const [art, w, h] of ART) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${file}?art=${art}&w=${w}&h=${h}`);
    await page.waitForFunction(() => document.title === "done", null, { timeout: 30000 });
    await page.locator("#c").screenshot({ path: path.join(__dirname, "..", "brand", `orbital-${art}.png`) });
    console.log("brand/orbital-" + art + ".png");
  }
  await b.close();
})();
