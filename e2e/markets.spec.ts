import { expect, test } from "@playwright/test";

import { PASSWORD } from "./constants";
import { createProfile, signIn } from "./helpers";

/**
 * Markets smoke: live Polymarket data (real network) → market page → argue the market → the argument is
 * listed on the market. Betting stays off here (no Builder credentials on the e2e server), so the trade
 * panel must say so and the Builder signing endpoint must refuse.
 */
test("browse live markets, argue one, and see betting gated off", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "One viewport is enough for a smoke of live third-party data.");
  const run = Date.now().toString(36);
  const person = await signIn(browser, { email: `pm-${run}@e2e.test`, password: PASSWORD });
  await createProfile(person, `pm_${run}`, "Market Fan");
  const { page } = person;

  // 1. The markets list comes from Polymarket.
  await page.goto("/markets");
  await expect(page.getByRole("heading", { name: "Markets", level: 1 })).toBeVisible();
  const firstCard = page.locator("article").first().getByRole("link");
  await expect(firstCard).toBeVisible({ timeout: 60_000 });
  const title = (await firstCard.textContent())?.trim() ?? "";

  // 2. The market page: options with Buy Yes / Buy No, and the trade panel gated off.
  await firstCard.click();
  await page.waitForURL(/\/markets\/[a-z0-9-]+$/);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /^Yes \d/ }).first()).toBeVisible();
  await expect(page.getByText("In-app betting isn't switched on yet.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open on Polymarket/ })).toHaveAttribute("href", /polymarket\.com\/event\//);

  // Picking "No" on an option moves the ticket to that side.
  await page.getByRole("button", { name: /^No \d/ }).first().click();
  await expect(page.getByRole("group", { name: "Side" }).getByRole("button", { name: /^No/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const marketUrl = page.url();

  // 3. The Builder signing endpoint refuses while trading is off.
  const sign = await page.evaluate(async () => {
    const response = await fetch("/api/polymarket/builder-sign", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "POST", path: "/submit", body: "{}" }),
    });
    return response.status;
  });
  expect(sign).toBe(403);

  // 4. Argue the market: /new carries the market link, and the argument shows up on the market page.
  await page.getByRole("link", { name: "Argue your call" }).click();
  await page.waitForURL(/\/new\?market=/);
  await expect(page.getByText("This argument will be linked to the Polymarket market")).toBeVisible();
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByLabel("Proposition").fill(`The favourite in this market will win, and the odds are right (${run}).`);
  await page.getByLabel("Your argument").fill("The leading option has the strongest fundamentals and the market agrees.");
  await page.getByRole("button", { name: "Publish argument" }).click();
  await page.waitForURL(/\/a\/[0-9a-f-]{36}$/);

  await page.goto(marketUrl);
  await expect(page.getByText(`(${run})`, { exact: false })).toBeVisible({ timeout: 60_000 });
});

test("the Builder signing endpoint needs a signed-in user", async ({ playwright }) => {
  const context = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  const response = await context.post("/api/polymarket/builder-sign", {
    data: { method: "POST", path: "/submit", body: "{}" },
  });
  expect(response.status()).toBe(401);
  await context.dispose();
});
