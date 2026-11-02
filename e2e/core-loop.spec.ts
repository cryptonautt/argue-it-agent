/**
 * Task 12: "core loop: two users debate and a verdict page renders" (mock provider, for CI speed).
 *
 * Two people sign in through the framework's Better Auth endpoints, pick a handle (/welcome), then in the
 * browser: post an argument → agree + comment → challenge → accept → both lock in openings → rebuttals →
 * the judge evaluates → the verdict page shows scores, verbatim quotes and "How this was judged".
 *
 * The judge is JUDGE_PROVIDER=mock, set explicitly by playwright.config.ts for this throwaway server only.
 * The Clips demo never uses the mock (plan Global Constraints).
 *
 * No HTTP tick endpoint exists in the Agent-Native port: judging is kicked by the `after()` shim when the last
 * rebuttal locks, and the 60 s interval job (server/plugins/jobs.ts) is the backstop. So the verdict page is
 * polled with a long `toPass`.
 *
 * UI labels below are the reference app's: Task 6 copies those components with their bodies unchanged.
 */
import { expect, test } from "@playwright/test";
import { PASSWORD } from "./constants";
import { createProfile, lockIn, signIn } from "./helpers";

test.skip(({ browserName }) => browserName !== "chromium", "chromium only");

const OPENING_FOR =
  "eFootball is the better game for most Nigerian players because access decides what people can play. It is free to download, while EA Sports FC costs a full price every year. Most young Nigerians play on phones, and eFootball runs on a mid-range Android, which means it reaches far more players than a console game.";
const OPENING_AGAINST = "EA FC is better. Better graphics and a proper career mode.";
const REBUTTAL_FOR =
  "My opponent talks about graphics, but the proposition is about most Nigerian players, and most do not own a PS5. Graphics do not matter on a console you do not have, so the access point stands unanswered.";
const REBUTTAL_AGAINST = "Career mode is still better and that matters.";

test("core loop: two users debate and a verdict page renders", async ({ browser }, testInfo) => {
  // About 15 full page loads against `agent-native dev`. Measured on Windows: 21-30 s per load once warm (the
  // framework's own modules are served unbundled), 60-85 s cold. The default 5-minute budget ran out at the
  // openings, with every step up to there passing. In-page steps take under 3 s.
  test.setTimeout(900_000);
  const run = `${testInfo.project.name.slice(0, 3)}${Date.now().toString(36).slice(-5)}`;
  const device = testInfo.project.use;
  const contextOptions = {
    viewport: device.viewport,
    userAgent: device.userAgent,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    deviceScaleFactor: device.deviceScaleFactor,
  };

  // 1. Two everyday users sign in (framework auth) and pick handles (ARGUE IT profile).
  const author = await signIn(browser, { email: `ada-${run}@e2e.test`, password: PASSWORD, contextOptions });
  const rival = await signIn(browser, { email: `tunde-${run}@e2e.test`, password: PASSWORD, contextOptions });
  await createProfile(author, `ada_${run}`, "Ada E2E");
  await createProfile(rival, `tunde_${run}`, "Tunde E2E");

  // 2. Ada posts an argument.
  await author.page.goto("/new");
  await author.page.getByLabel("Title").fill(`eFootball beats EA FC ${run}`);
  await author.page.getByLabel("Category").selectOption("gaming");
  await author.page
    .getByLabel("Proposition")
    .fill("eFootball is a better football game than EA Sports FC for most Nigerian players.");
  await author.page
    .getByLabel("Your argument")
    .fill("It is free, it runs on the phones people actually own, and it is what everybody around me plays.");
  await author.page.getByRole("button", { name: "Publish argument" }).click();
  await author.page.waitForURL(/\/a\/[0-9a-f-]{36}$/);
  const argumentUrl = author.page.url();

  // 3. Tunde agrees (a free position) and comments (free discussion, never judged).
  await rival.page.goto(argumentUrl);
  await rival.page.getByRole("group", { name: "Your free position" }).getByRole("button", { name: "Agree" }).click();
  await expect(rival.page.getByText("You're AGREE.")).toBeVisible();
  await rival.page.getByLabel("Comment (free discussion — not judged)").fill("Facts, but EA FC career mode is still elite.");
  await rival.page.getByRole("button", { name: "Post comment" }).click();
  await expect(rival.page.getByText("Facts, but EA FC career mode is still elite.")).toBeVisible();

  // 4. Tunde challenges Ada to a judged debate, arguing AGAINST, after reviewing the frozen terms.
  await rival.page.getByRole("link", { name: /Challenge this/ }).first().click();
  await rival.page.waitForURL(/\/challenge\/new/);
  await rival.page.getByText("I’ll argue it’s false").click();
  await rival.page.getByRole("button", { name: "Review terms" }).click();
  await rival.page.getByRole("button", { name: "Send challenge" }).click();
  await rival.page.waitForURL(/\/c\/[0-9a-f-]{36}$/);
  const roomUrl = rival.page.url();

  // 5. Ada reads the terms and accepts.
  await author.page.goto(roomUrl);
  await author.page.getByText("I’ve read the terms, the rubric and the no-show rule, and I agree to them.").click();
  await author.page.getByRole("button", { name: "Accept and argue FOR" }).click();
  await expect(author.page.getByLabel("Opening argument", { exact: true })).toBeVisible();

  // 6. Both lock in sealed openings; locking early starts the rebuttal round straight away.
  await lockIn(author.page, "opening", OPENING_FOR);
  await rival.page.reload();
  await lockIn(rival.page, "opening", OPENING_AGAINST);

  // 7. Rebuttals (each side now sees the other's opening).
  await author.page.reload();
  await expect(author.page.getByText(OPENING_AGAINST)).toBeVisible();
  await lockIn(author.page, "rebuttal", REBUTTAL_FOR);
  await rival.page.reload();
  await lockIn(rival.page, "rebuttal", REBUTTAL_AGAINST);

  // 8. The judge evaluates (after() kick on lock; the 60 s interval tick is the backstop).
  const verdictUrl = `${roomUrl}/verdict`;
  await expect(async () => {
    await author.page.goto(verdictUrl);
    await expect(author.page.getByRole("heading", { name: "How this was judged" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 180_000, intervals: [2_000, 3_000, 5_000] });

  // 9. The verdict page shows the outcome, per-criterion scores, verbatim quotes and the fairness panel.
  const verdictPage = author.page;
  await expect(verdictPage.getByText("The AI verdict is in").first()).toBeVisible();
  await expect(verdictPage.getByRole("heading", { name: /Tale of the tape|The AI's scorecard/ })).toBeVisible();
  await verdictPage.getByText("Why these scores").first().click();
  await expect(verdictPage.locator("blockquote").first()).toBeVisible();
  const quotes = await verdictPage.locator("details[open] blockquote").allInnerTexts();
  const sources = [OPENING_FOR, OPENING_AGAINST, REBUTTAL_FOR, REBUTTAL_AGAINST].join(" ");
  const normalise = (s: string) => s.replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();
  expect(quotes.some((q) => q.length > 3 && sources.includes(normalise(q)))).toBe(true);
  await expect(verdictPage.getByText(/blind/i).first()).toBeVisible();

  await author.page.context().close();
  await rival.page.context().close();
});
