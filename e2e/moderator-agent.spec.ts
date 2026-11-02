/**
 * Task 12: "moderator approves an agent draft". No live LLM in e2e.
 *
 * "Seed a draft row directly": the dev server holds the single-process PGlite, so the test cannot open the
 * database itself. Instead it writes the draft through the same `save-decision-draft` action the agent calls
 * (Task 8), with a citation sliced verbatim from the cited side's text. That is deterministic and needs no
 * model; the agent's own drafting is exercised in the live demo, not here.
 *
 * Needs the demo seed (Task 9): playwright.config.ts runs scripts/seed.ts against the throwaway e2e database
 * before the server starts. It provides the moderator ngozi@argueit.test and an open appeal by emeka.
 *
 * Desktop project only: the seeded appeal can be decided once, so a second project run would hit CONFLICT.
 */
import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, MODERATOR_EMAIL, PASSWORD } from "./constants";
import { callAction, createProfile, findAllDeep, findDeep, signIn } from "./helpers";

test.skip(({ browserName }) => browserName !== "chromium", "chromium only");

interface UntrustedSubmission {
  untrusted: true;
  side: "A" | "B";
  text: string;
}

test("moderator approves an agent draft", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop only (the seeded appeal can be decided once)");
  const mod = await signIn(browser, { email: MODERATOR_EMAIL, password: DEMO_PASSWORD });

  // 1. The open appeal from the seed, as the review queue lists it (reference AppealQueueItem.appeal).
  const queue = await callAction(mod.page, "list-review-queue", {}, "GET");
  const appeal = findDeep<{ id: string }>(
    queue,
    (v) => v.status === "open" && typeof v.id === "string" && "ground" in v && "appellantSide" in v,
  );
  expect(appeal, `no open appeal in list-review-queue: ${JSON.stringify(queue).slice(0, 500)}`).toBeTruthy();
  const appealId = appeal!.id;

  // 2. Read the case like the agent does; both submissions are marked untrusted (Task 8).
  const reviewCase = await callAction(mod.page, "get-review-case", { kind: "appeal", targetId: appealId }, "GET");
  const submissions = findAllDeep<UntrustedSubmission>(
    reviewCase,
    (v) => v.untrusted === true && (v.side === "A" || v.side === "B") && typeof v.text === "string",
  );
  expect(submissions.map((s) => s.side).sort()).toEqual(expect.arrayContaining(["A", "B"]));
  const sideA = submissions.find((s) => s.side === "A" && s.text.trim().split(/\s+/).length >= 6)!;
  const quote = sideA.text.trim().split(/\s+/).slice(0, 8).join(" ");
  // Rubric criterion: first object that looks like a weighted criterion; falls back to a reference key.
  const criterion =
    findDeep<{ key?: string; name?: string }>(
      reviewCase,
      (v) => typeof v.weight === "number" && (typeof v.key === "string" || typeof v.name === "string"),
    ) ?? {};
  const draftNote = "The appeal names no specific overlooked point; the verdict addressed the evidence. Uphold.";

  // 3. Write the draft through the agent's own drafting action (moderator-authorised, no approval needed).
  const saved = await callAction<{ id: string }>(mod.page, "save-decision-draft", {
    kind: "appeal",
    targetId: appealId,
    recommendation: "uphold",
    note: draftNote,
    citations: [{ side: "A", quote, criterion: criterion.key ?? criterion.name ?? "evidence" }],
    confidence: "medium",
  });
  const draftId = saved.id;
  expect(draftId).toBeTruthy();

  // 4. The moderator sees the draft card in the review queue, labelled as the agent's work.
  // Tab encoding from 5b-screens-b (docs/port-notes.md): /admin/review?tab=review|appeals.
  await mod.page.goto("/admin/review?tab=appeals");
  // DraftCard root is <section aria-label="Agent draft">; pick the one citing our quote.
  const card = mod.page.getByRole("region", { name: "Agent draft" }).filter({ hasText: quote });
  await expect(card).toBeVisible();
  await expect(card.getByText("Drafted by the agent: check before approving")).toBeVisible();
  await expect(card.getByText(quote, { exact: false })).toBeVisible();

  // 5. The human edits the note, then approves with one click.
  const editedNote = `${draftNote} Checked by a human moderator.`;
  const note = card.getByLabel(/Written reason/);
  await note.fill(editedNote);
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card).toBeHidden({ timeout: 30_000 });

  // 6. The draft is approved and recorded as edited by the human; the appeal is no longer open.
  // TODO verify: list-decision-drafts input once Task 8 lands; `{ status: "approved" }` is assumed to be accepted
  // (or ignored) and the approved row returned with its `edited` flag.
  const drafts = await callAction(mod.page, "list-decision-drafts", { status: "approved" }, "GET");
  const approved = findDeep<{ status: string; edited: boolean }>(drafts, (v) => v.id === draftId);
  expect(approved, `draft ${draftId} not in list-decision-drafts: ${JSON.stringify(drafts).slice(0, 500)}`).toBeTruthy();
  expect(approved!.status).toBe("approved");
  expect(approved!.edited).toBe(true);
  const after = await callAction(mod.page, "list-review-queue", {}, "GET");
  const stillOpen = findDeep(after, (v) => v.id === appealId && v.status === "open");
  expect(stillOpen).toBeUndefined();

  await mod.page.context().close();
});

test("a non-staff user cannot write a decision draft (FORBIDDEN, Review Focus #3)", async ({ browser }) => {
  const run = Date.now().toString(36).slice(-6);
  const user = await signIn(browser, { email: `rando-${run}@e2e.test`, password: PASSWORD });
  await createProfile(user, `rando_${run}`, "Rando E2E");
  await expect(
    callAction(user.page, "save-decision-draft", {
      kind: "review",
      targetId: "00000000-0000-0000-0000-000000000000",
      recommendation: "A",
      note: "should never be written",
      citations: [],
      confidence: "low",
    }),
  ).rejects.toThrow(/FORBIDDEN|403/);
  await user.page.context().close();
});
