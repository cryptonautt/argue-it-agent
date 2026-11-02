/**
 * Blinding: participant identities never reach the judge (design §4.3.1). Owner: fairness.
 *
 * Tests the judge's pure `redactIdentities` on edge cases, then the full production `buildCaseFile` path
 * through a real (in-memory) database with the fairness identity-bait cases.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { profiles, users } from "@domain/db/schema";
import { buildCaseFile, redactIdentities, type RedactionTarget } from "@domain/judging";
import { FairnessDatabase } from "../lib/case-source";
import { caseFileText, checkIdentityLeaks } from "../lib/identity";
import { loadCases } from "../lib/load-cases";

/** Targets the way production builds them for a FOR participant: "@handle", bare handle, display name. */
const forSide = (handle: string, displayName: string): RedactionTarget[] => [
  { term: `@${handle}`, replacement: "[Side A]" },
  { term: handle, replacement: "[Side A]" },
  { term: displayName, replacement: "[Side A]" },
];
const redact = (text: string, targets: RedactionTarget[]) => redactIdentities(text, targets).text;

describe("redactIdentities — word boundaries", () => {
  const ade = forSide("ade", "Ade Bello");

  it("does not touch a handle that appears inside another word", () => {
    expect(redact("I made it; Adebayo and Kunade agreed, then faded.", ade)).toBe("I made it; Adebayo and Kunade agreed, then faded.");
  });

  it("does not touch a longer handle that merely starts with the participant's handle", () => {
    expect(redact("chidi_dev_fan replied to chidi_devs", forSide("chidi_dev", "Chidi Okeke"))).toBe("chidi_dev_fan replied to chidi_devs");
  });

  it("redacts the handle next to punctuation, possessives and emoji", () => {
    expect(redact("(ade), ade's point, ade🔥, ade.", ade)).toBe("([Side A]), [Side A]'s point, [Side A]🔥, [Side A].");
  });

  it("redacts @mentions, including at the start of the text and inside hashtags", () => {
    expect(redact("@ade said so. Ask @ade! #ade", ade)).toBe("[Side A] said so. Ask [Side A]! #[Side A]");
  });

  it("redacts a profile link path segment", () => {
    expect(redact("see https://x.com/ade for my record", ade)).toBe("see https://x.com/[Side A] for my record");
  });

  it("counts every redaction", () => {
    expect(redactIdentities("@ade, ade and Ade Bello", ade).redactions).toBe(3);
  });
});

describe("redactIdentities — casing and spacing", () => {
  const chidi = forSide("chidi_dev", "Chidi Okeke");

  it("is case-insensitive", () => {
    expect(redact("CHIDI_DEV, Chidi_Dev, chidi okeke, CHIDI OKEKE", chidi)).toBe("[Side A], [Side A], [Side A], [Side A]");
  });

  it("matches a display name split by extra spaces or a line break", () => {
    expect(redact("Chidi  Okeke and Chidi\nOkeke", chidi)).toBe("[Side A] and [Side A]");
  });

  it("prefers the longest term, so a full name is one redaction, not two", () => {
    const result = redactIdentities("Chidi Okeke", [...chidi, { term: "Chidi", replacement: "[Side A]" }]);
    expect(result).toEqual({ text: "[Side A]", redactions: 1 });
  });

  it("leaves a first name alone when only the full display name is a target (reported as advisory)", () => {
    expect(redact("Chidi is wrong", chidi)).toBe("Chidi is wrong");
  });
});

describe("redactIdentities — two participants", () => {
  it("labels each side separately", () => {
    const targets = [...forSide("ada", "Ada Obi"), { term: "@kemi", replacement: "[Side B]" as const }, { term: "kemi", replacement: "[Side B]" as const }];
    expect(redact("@ada thinks @kemi is wrong; kemi disagrees with Ada Obi", targets)).toBe(
      "[Side A] thinks [Side B] is wrong; [Side B] disagrees with [Side A]",
    );
  });

  it("uses the neutral [participant] when both sides share a name", () => {
    const targets: RedactionTarget[] = [
      { term: "Chris", replacement: "[Side A]" },
      { term: "chris", replacement: "[Side B]" },
    ];
    expect(redact("Chris said", targets)).toBe("[participant] said");
  });
});

describe("redactIdentities — Unicode", () => {
  const yoruba = forSide("ola_a", "Ọlá Adébáyọ̀");

  it("redacts a display name with Yoruba diacritics (same normal form)", () => {
    expect(redact("Ọlá Adébáyọ̀ wrote this", yoruba)).toBe("[Side A] wrote this");
  });

  it("treats accented letters as word characters (no partial matches inside names)", () => {
    expect(redact("Adébáyọ̀ola is someone else", forSide("zz_x", "Adébáyọ̀"))).toBe("Adébáyọ̀ola is someone else");
  });

  // Known gaps (docs/requests.md 2026-10-31 fairness -> judge, item 3). `it.fails` passes while the gap
  // exists; when the judge fixes it this test starts failing — then change it to `it`.
  it("FIXED (was a known gap): redacts the same name typed in decomposed (NFD) form", () => {
    expect(redact("Ọlá Adébáyọ̀ wrote this".normalize("NFD"), yoruba)).toBe("[Side A] wrote this");
  });

  it("FIXED (was a known gap): redacts a handle written in fullwidth letters", () => {
    expect(redact("ＡＤＡ says hi", forSide("ada", "Ada Obi"))).toBe("[Side A] says hi");
  });

  it("FIXED (was a known gap): redacts a handle with a zero-width space hidden inside it", () => {
    expect(redact("I am @chidi​_dev", forSide("chidi_dev", "Chidi Okeke"))).toBe("I am [Side A]");
  });
});

describe("buildCaseFile — production path with the identity-bait cases", () => {
  const cases = loadCases();
  const baitCases = cases.filter((c) => c.identityBait);
  let database: FairnessDatabase;

  beforeAll(async () => {
    database = await FairnessDatabase.open();
  }, 60_000);
  afterAll(async () => {
    await database.close();
  });

  it.each(baitCases.map((c) => [c.id, c] as const))("%s: no participant handle or display name reaches the judge", async (_id, c) => {
    const { built } = await database.prepare(c);
    expect(checkIdentityLeaks(c, built.caseFile).leaks).toEqual([]);
    if (c.identityBait?.technique !== "famous_claim") expect(built.redactionCount).toBeGreaterThan(0);
    const text = caseFileText(built.caseFile);
    expect(text).not.toMatch(/followers?\b.*@/iu); // the "@handle with N followers" pattern is gone
  });

  it("labels the opponent correctly when a side names the other side", async () => {
    const c = cases.find((x) => x.id === "identity-opponent-handle-coding");
    if (!c) throw new Error("case missing");
    const { built } = await database.prepare(c);
    expect(built.caseFile.sides.B.opening?.text).toContain("Don't listen to [Side A]. [Side A] is a junior developer");
  });

  it("contains no user ids, emails or account names anywhere in the case file", async () => {
    const c = cases.find((x) => x.id === "identity-follower-count-home-based");
    if (!c) throw new Error("case missing");
    const { built, competitionId } = await database.prepare(c);
    const json = JSON.stringify(built.caseFile);
    const participantRows = await database.db.select({ id: users.id, email: users.email, name: users.name }).from(users);
    for (const row of participantRows) {
      expect(json).not.toContain(row.id);
      expect(json).not.toContain(row.email);
    }
    expect(json).not.toContain(competitionId);
  });

  it("redacts the account name even when it differs from the display name", async () => {
    const c = cases.find((x) => x.id === "identity-follower-count-home-based");
    if (!c) throw new Error("case missing");
    const [profile] = await database.db.select().from(profiles).where(eq(profiles.handle, c.participants.A.handle));
    if (!profile) throw new Error("profile missing");
    await database.db.update(users).set({ name: "Olumide Real-Name" }).where(eq(users.id, profile.userId));
    const variant = {
      ...c,
      id: "identity-account-name-variant",
      sides: { ...c.sides, A: { ...c.sides.A, opening: { text: "Olumide Real-Name here: home-based players have more passion.", links: [] } } },
    };
    const { built } = await database.prepare(variant);
    expect(built.caseFile.sides.A.opening?.text).toBe("[Side A] here: home-based players have more passion.");
  });

  it("keeps a bare name that is the debate's subject but still redacts the @mention", async () => {
    const c = cases.find((x) => x.id === "subjective-davido-taste-as-fact");
    if (!c) throw new Error("case missing");
    const subject = {
      ...c,
      id: "subject-named-like-participant",
      participants: { ...c.participants, A: { handle: "davido", displayName: "Davido Fan" } },
      sides: { ...c.sides, A: { ...c.sides.A, opening: { text: "Davido is the greatest, says @davido.", links: [] } } },
    };
    const { built } = await database.prepare(subject);
    expect(built.caseFile.sides.A.opening?.text).toBe("Davido is the greatest, says [Side A].");
    expect(checkIdentityLeaks(subject, built.caseFile).leaks).toEqual([]);
  });

  it("buildCaseFile is deterministic: the same frozen debate always hashes the same", async () => {
    const c = cases.find((x) => x.id === "draw-jollof");
    if (!c) throw new Error("case missing");
    const first = await database.prepare(c);
    const second = await buildCaseFile(first.competitionId);
    expect(second.caseHash).toBe(first.built.caseHash);
    expect(second.caseFile).toEqual(first.built.caseFile);
  });
});
