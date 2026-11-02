/**
 * Core-loop actions end to end against an isolated in-memory PGlite (same harness as the reference
 * integration tests). Actions are called the way the agent calls them (`caller: "tool"`); direct `.run()`
 * skips the approval gate, which is the framework's job and is not under test here.
 */
import { isActionContractError, type ActionContractError, type ActionRunContext } from "@agent-native/core/action";
import { beforeEach, describe, expect, it } from "vitest";

import { actAs, actAsSignedOut } from "@domain/test-helpers/auth";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestArgument, createTestUser, type TestUser } from "@domain/test-helpers/factories";

import createArgument from "./create-argument";
import createProfile from "./create-profile";
import decideAppeal from "./decide-appeal";
import getArgument from "./get-argument";
import getCompetition from "./get-competition";
import getSession from "./get-session";
import listCategories from "./list-categories";
import listFeed from "./list-feed";
import listReviewQueue from "./list-review-queue";
import lockSubmission from "./lock-submission";
import respondToChallenge from "./respond-to-challenge";
import saveSubmission from "./save-submission";
import sendChallenge from "./send-challenge";

const t = setupTestDb();
const tool: ActionRunContext = { caller: "tool" };

async function caught(promise: unknown): Promise<ActionContractError> {
  try {
    await promise;
  } catch (error) {
    if (isActionContractError(error)) return error;
    throw error;
  }
  throw new Error("expected the action to fail");
}

let amaka: TestUser;
let chidi: TestUser;

beforeEach(async () => {
  amaka = await createTestUser(t.db, { handle: "amaka" });
  chidi = await createTestUser(t.db, { handle: "chidi" });
});

describe("core loop", () => {
  it("create-argument → send-challenge → respond-to-challenge(accept) → save+lock both openings and rebuttals → competition reaches evaluating", async () => {
    actAs(amaka.user.id);
    const { id: argumentId } = await createArgument.run(
      {
        title: "Jollof rice belongs to Nigeria",
        categorySlug: "sports",
        proposition: "Nigerian jollof rice is better than Ghanaian jollof rice.",
        body: "Smoky party jollof cooked over firewood has a depth of flavour no other version matches.",
        links: [],
      },
      tool,
    );
    expect(argumentId).toMatch(/^[0-9a-f-]{36}$/);

    actAs(chidi.user.id);
    const { competitionId } = await sendChallenge.run(
      {
        argumentId,
        proposition: "Nigerian jollof rice is better than Ghanaian jollof rice.",
        challengerSide: "AGAINST",
        roundDurationHours: 24,
      },
      tool,
    );

    actAs(amaka.user.id);
    const pending = await getCompetition.run({ id: competitionId }, tool);
    expect(pending.status).toBe("pending_acceptance");
    const accepted = await respondToChallenge.run(
      { competitionId, response: "accept", termsHash: pending.termsHash },
      tool,
    );
    expect(accepted.status).toBe("active");
    expect(accepted.round).toBe("opening");

    for (const round of ["opening", "rebuttal"] as const) {
      for (const debater of [amaka, chidi]) {
        actAs(debater.user.id);
        const body = `${debater.profile.handle} ${round}: a clear, reasoned case with an example.`;
        const saved = await saveSubmission.run({ competitionId, round, body, links: [] }, tool);
        expect(saved.savedAt).toEqual(expect.any(String));
        await lockSubmission.run({ competitionId, round, body, links: [] }, tool);
      }
    }

    actAs(chidi.user.id);
    const room = await getCompetition.run({ id: competitionId }, tool);
    expect(room.status).toBe("evaluating");
  });

  it("accept without termsHash fails with VALIDATION and a field message", async () => {
    const argument = await createTestArgument(t.db, amaka.user.id);
    actAs(chidi.user.id);
    const { competitionId } = await sendChallenge.run(
      { argumentId: argument.id, proposition: argument.proposition, challengerSide: "AGAINST", roundDurationHours: 24 },
      tool,
    );
    actAs(amaka.user.id);
    const error = await caught(respondToChallenge.run({ competitionId, response: "accept" }, tool));
    expect(error.errorCode).toBe("VALIDATION");
    expect(error.details).toHaveProperty("fieldErrors.termsHash");
  });

  it("list-review-queue rejects a non-moderator with FORBIDDEN", async () => {
    actAs(chidi.user.id);
    const error = await caught(listReviewQueue.run({}, tool));
    expect(error.errorCode).toBe("FORBIDDEN");
  });

  it("list-review-queue serves a moderator", async () => {
    const ngozi = await createTestUser(t.db, { handle: "ngozi", role: "moderator" });
    actAs(ngozi.user.id);
    const queue = await listReviewQueue.run({}, tool);
    expect(queue.counts).toEqual({ review: 0, appeals: 0 });
  });

  it("signed-out calls fail with UNAUTHENTICATED", async () => {
    actAsSignedOut();
    const error = await caught(listFeed.run({ tab: "for-you" }, tool));
    expect(error.errorCode).toBe("UNAUTHENTICATED");
  });
});

describe("reads", () => {
  it("list-categories returns the 5 seeded categories", async () => {
    actAs(amaka.user.id);
    const { categories } = await listCategories.run({}, tool);
    expect(categories).toHaveLength(5);
  });

  it("list-feed reads a first page without a cursor", async () => {
    await createTestArgument(t.db, amaka.user.id);
    actAs(chidi.user.id);
    const page = await listFeed.run({ tab: "for-you" }, tool);
    expect(page.items.length).toBeGreaterThanOrEqual(1);
  });

  it("get-argument hides a hidden argument's body from other users but not from staff", async () => {
    const hidden = await createTestArgument(t.db, amaka.user.id, { status: "hidden", body: "SECRET BODY TEXT here." });
    actAs(chidi.user.id);
    const asOther = await getArgument.run({ id: hidden.id }, tool);
    expect(asOther.visibility).toBe("placeholder");
    expect(JSON.stringify(asOther)).not.toContain("SECRET BODY TEXT");

    const ngozi = await createTestUser(t.db, { handle: "ngozi", role: "moderator" });
    actAs(ngozi.user.id);
    const asStaff = await getArgument.run({ id: hidden.id }, tool);
    expect(asStaff.visibility).toBe("revealed");
    expect(JSON.stringify(asStaff)).toContain("SECRET BODY TEXT");
  });

  it("get-argument returns the screen extras for the viewer", async () => {
    const argument = await createTestArgument(t.db, amaka.user.id);
    actAs(chidi.user.id);
    const result = await getArgument.run({ id: argument.id }, tool);
    expect(result.visibility).toBe("full");
    expect(result.viewer).toMatchObject({ id: chidi.user.id, handle: "chidi" });
    expect(result.follow).toMatchObject({ userId: amaka.user.id, following: false });
    expect(result.comments.total).toBe(0);
    expect(result.hasOpenDebates).toBe(false);

    actAs(amaka.user.id);
    const own = await getArgument.run({ id: argument.id }, tool);
    expect(own.follow).toBeNull();
  });

  it("get-session returns the signed-in user, and null when signed out", async () => {
    actAs(amaka.user.id);
    await expect(getSession.run({}, { caller: "frontend" })).resolves.toMatchObject({
      id: amaka.user.id,
      handle: "amaka",
      role: "user",
    });
    actAsSignedOut();
    await expect(getSession.run({}, { caller: "frontend" })).resolves.toBeNull();
  });

  it("get-argument on an unknown id fails with NOT_FOUND", async () => {
    actAs(amaka.user.id);
    const error = await caught(getArgument.run({ id: "00000000-0000-4000-8000-000000000000" }, tool));
    expect(error.errorCode).toBe("NOT_FOUND");
  });
});

describe("create-profile", () => {
  it("creates users + profiles for a new framework email, then refuses a second profile and a taken handle", async () => {
    const created = await createProfile.run({ handle: "Tunde_1" }, { caller: "frontend", userEmail: "Tunde@ArgueIt.test" });
    expect(created).toMatchObject({ handle: "tunde_1", displayName: "tunde_1" });

    const again = await caught(createProfile.run({ handle: "tunde_2" }, { caller: "frontend", userEmail: "tunde@argueit.test" }));
    expect(again.errorCode).toBe("CONFLICT");

    const taken = await caught(createProfile.run({ handle: "amaka" }, { caller: "frontend", userEmail: "new@argueit.test" }));
    expect(taken.errorCode).toBe("CONFLICT");
    expect(taken.details).toHaveProperty("fieldErrors.handle");
  });

  it("rejects a reserved handle", async () => {
    await expect(
      createProfile.run({ handle: "admin" }, { caller: "frontend", userEmail: "x@argueit.test" }),
    ).rejects.toThrow();
  });
});

describe("tool schemas", () => {
  it("decide-appeal keeps its discriminated union usable as a tool schema", () => {
    const parameters = JSON.stringify(decideAppeal.tool.parameters);
    for (const decision of ["uphold", "reevaluate", "overturn"]) expect(parameters).toContain(decision);
    expect(parameters).toContain("appealId");
  });
});
