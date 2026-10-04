// Renders the static export in Chromium and saves desktop and mobile screenshots.
// Usage: node scripts/screenshots.mjs <outDir> [route ...]
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "playwright-core";

const outDir = process.argv[2] ?? "screenshots";
const routes = process.argv.slice(3).length ? process.argv.slice(3) : ["/"];
const root = new URL("../out/", import.meta.url).pathname;
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };

const server = createServer(async (req, res) => {
  let path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (path.endsWith("/")) path += "index.html";
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(0);
const port = server.address().port;
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
for (const route of routes) {
  const name = route === "/" ? "home" : route.replace(/\//g, "");
  for (const [label, viewport, scale] of [["desktop", { width: 1440, height: 900 }, 1], ["mobile", { width: 390, height: 844 }, 2]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: scale });
    await page.goto(`http://localhost:${port}${route}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(outDir, `${name}-${label}.png`), fullPage: true });
    await page.close();
  }
  console.log("captured", route);
}
await browser.close();
server.close();
