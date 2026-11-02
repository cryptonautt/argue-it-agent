// Warm the dev server before recording the demo: opens each demo page once in a headless browser, so Vite
// has already transformed and pre-bundled every module the pages need. The first load of a page on a fresh
// dev server takes up to a minute; after this it takes seconds.
//
// Usage (dev server already running):
//   WARM_EMAIL=ngozi@argueit.test WARM_PASSWORD=... pnpm warm <origin> [extra paths...]
// origin is the dev server's Local URL, e.g. http://localhost:3200. Sign in as a moderator so /admin/review renders its full page.
// Then open each page once more in the browser you record with: that browser has its own cache.
import { chromium } from "@playwright/test";

const [origin, ...extra] = process.argv.slice(2);
if (!origin?.startsWith("http")) {
  console.error("Usage: pnpm warm <origin> [extra paths...], e.g. pnpm warm http://localhost:3200 /c/<id>/verdict");
  process.exit(1);
}
const pages = ["/", "/new", "/challenge/new", "/rules", "/admin/review", "/admin/review?tab=appeals", ...extra];

const email = process.env.WARM_EMAIL;
const password = process.env.WARM_PASSWORD;
if (!email || !password) {
  console.error("Set WARM_EMAIL and WARM_PASSWORD (a signed-up demo persona).");
  process.exit(1);
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL === "bundled" ? undefined : (process.env.PW_CHANNEL ?? "chrome") });
try {
  const context = await browser.newContext({ baseURL: origin });
  const headers = { origin, "x-agent-native-frontend": "1" };
  const login = await context.request.post("/_agent-native/auth/login", { data: { email, password }, headers });
  if (!login.ok()) throw new Error(`login ${email}: ${login.status()} ${await login.text()}`);

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(180_000);
  for (const path of pages) {
    const started = performance.now();
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 180_000 }).catch(() => {});
    console.log(`${path}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
  }
} finally {
  await browser.close();
}
