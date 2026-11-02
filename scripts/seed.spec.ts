/**
 * The demo seed (scripts/seed.ts) runs end to end through the real domain code against a fresh, isolated
 * in-memory PGlite (never the shared data/pglite database). The judged fixtures use the offline mock judge,
 * which the seed passes to the pipeline explicitly; JUDGE_PROVIDER is not set here or by the seed.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { setupTestDb } from "@domain/test-helpers/db";
import { appeals, competitions, evaluationJobs, evaluationPasses, profiles, reports, submissions, users, verdicts } from "@domain/db/schema";
import { DEBATES, DEMO_APPEAL, DEMO_USERS, INJECTION_PHRASE, seedDemo, type SeedSummary } from "./seed";

const SEED_TIMEOUT = 300_000;
const demoEmails = DEMO_USERS.map((u) => u.email);

describe("seed (fresh database)", () => {
  const t = setupTestDb({ resetBetweenTests: false });
  let first: SeedSummary;

  it(
    "seed is idempotent and creates 1 open appeal, ≥1 needs_review competition, ≥1 injection report",
    async () => {
      // Run the first seed the way the CLI runs it: outside vitest the judging queue's auto-kick is live (the
      // `next/server` after() shim schedules it), and a background kick must not claim a seeded job.
      const vitestFlag = process.env.VITEST;
      delete process.env.VITEST;
      try {
        first = await seedDemo(t.db);
      } finally {
        process.env.VITEST = vitestFlag;
      }
      await new Promise((resolve) => setTimeout(resolve, 50)); // let any stray detached kick run before we look
      expect(first.skipped).toBe(false);
      const jobs = await t.db.select().from(evaluationJobs);
      expect(jobs).toHaveLength(5);
      for (const job of jobs) expect(job).toMatchObject({ status: "done", attempts: 1, lastError: null });
      expect(first.warnings).toEqual([]);
      expect(first.created).toMatchObject({ users: 8, profiles: 8, arguments: 8, debates: 7, appeals: 1 });

      const countAll = async () => ({
        users: (await t.db.select({ n: sql<number>`count(*)::int` }).from(users))[0]?.n,
        competitions: (await t.db.select({ n: sql<number>`count(*)::int` }).from(competitions))[0]?.n,
        appeals: (await t.db.select({ n: sql<number>`count(*)::int` }).from(appeals))[0]?.n,
        reports: (await t.db.select({ n: sql<number>`count(*)::int` }).from(reports))[0]?.n,
        verdicts: (await t.db.select({ n: sql<number>`count(*)::int` }).from(verdicts))[0]?.n,
      });
      const before = await countAll();

      const second = await seedDemo(t.db);
      expect(second.skipped).toBe(true);
      expect(Object.values(second.created).every((n) => n === 0)).toBe(true);
      expect(second.competitions).toEqual(first.competitions);
      expect(second.appealId).toBe(first.appealId);
      expect(await countAll()).toEqual(before);
      expect(before.users).toBe(8);

      // Exactly one open appeal, and it is emeka's, on the "appealed" debate, ground "evidence overlooked".
      const open = await t.db.select().from(appeals).where(eq(appeals.status, "open"));
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({
        appellantId: first.users.emeka,
        competitionId: first.competitions.appealed,
        ground: "evidence_overlooked",
        text: DEMO_APPEAL.text,
      });
      const [appealed] = await t.db.select({ s: competitions.status }).from(competitions).where(eq(competitions.id, first.competitions.appealed));
      expect(appealed?.s).toBe("under_appeal");
      // Emeka lost the appealed debate (he is FOR = side A, so B won).
      const [appealedVerdict] = await t.db
        .select()
        .from(verdicts)
        .where(and(eq(verdicts.competitionId, first.competitions.appealed), eq(verdicts.isCurrent, true)));
      expect(appealedVerdict?.outcome).toBe("B");
      expect(appealedVerdict?.winnerUserId).toBe(first.users.ada);
      // The appeal describes the stored verdict truthfully: emeka's evidence was scored as having no figures.
      const emekaEvidence = appealedVerdict?.explanation?.perCriterion.find((c) => c.key === "evidence")?.A.reason;
      expect(emekaEvidence).toMatch(/(?<!\d)0 specific figure/);
      const quoted = "Ghana and Morocco both pick more players from their own leagues than we do.";
      expect(DEMO_APPEAL.text).toContain(quoted);
      expect(DEBATES.appealed.openingFor).toContain(quoted);

      // Debates waiting for human review: the reference's inconclusive Bitcoin debate, and the injection debate (so
      // the moderator agent's triage, which walks list-review-queue, reaches its injection report).
      const review = await t.db.select({ id: competitions.id }).from(competitions).where(eq(competitions.status, "needs_review"));
      expect(review.map((r) => r.id)).toEqual(expect.arrayContaining([first.competitions.inconclusive, first.competitions.injection]));

      // The injection pre-scan opened an automatic report on side B's (AGAINST) opening.
      const [injectedSubmission] = await t.db
        .select({ id: submissions.id, side: submissions.side, body: submissions.body })
        .from(submissions)
        .where(and(eq(submissions.competitionId, first.competitions.injection), eq(submissions.round, "opening"), eq(submissions.side, "AGAINST")));
      expect(injectedSubmission?.body).toContain(INJECTION_PHRASE);
      const injectionReports = await t.db
        .select()
        .from(reports)
        .where(and(eq(reports.reason, "prompt_injection"), eq(reports.isAutomatic, true)));
      expect(injectionReports.length).toBeGreaterThanOrEqual(1);
      expect(injectionReports.map((r) => r.targetId)).toContain(injectedSubmission?.id);
      expect(injectionReports.find((r) => r.targetId === injectedSubmission?.id)).toMatchObject({ targetType: "submission", status: "open" });

      // The reference's four debates keep their states.
      const statusOf = async (id: string) =>
        (await t.db.select({ s: competitions.status }).from(competitions).where(eq(competitions.id, id)))[0]?.s;
      expect(await statusOf(first.competitions.completed)).toBe("completed");
      expect(await statusOf(first.competitions.active)).toBe("active");
      expect(await statusOf(first.competitions.pending)).toBe("pending_acceptance");
      const [unsure] = await t.db.select().from(verdicts).where(eq(verdicts.competitionId, first.competitions.inconclusive));
      expect(unsure?.outcome).toBe("inconclusive");

      const staff = await t.db.select({ email: users.email, role: users.role }).from(users).where(inArray(users.role, ["admin", "moderator"]));
      expect(staff).toEqual(
        expect.arrayContaining([
          { email: "admin@argueit.test", role: "admin" },
          { email: "ngozi@argueit.test", role: "moderator" },
        ]),
      );
    },
    SEED_TIMEOUT,
  );

  it("chidi loses the narrow-loss debate by more than the draw band, mostly on rebuttal, with the appeal window open", async () => {
    const id = first.competitions.narrowLoss;
    expect(DEBATES.narrowLoss.challengerSide).toBe("FOR"); // chidi is side A
    const [verdict] = await t.db.select().from(verdicts).where(and(eq(verdicts.competitionId, id), eq(verdicts.isCurrent, true)));
    expect(verdict).toMatchObject({ outcome: "B", decidedBy: "ai", winnerUserId: first.users.tunde });

    const scores = verdict?.scores;
    expect(scores).toBeTruthy();
    if (!scores) return;
    const gap = scores.totals.B - scores.totals.A;
    expect(gap).toBeGreaterThan(3); // a gap of 3 or less would be a draw
    expect(gap).toBeLessThanOrEqual(10); // narrow

    const weightedGap = (c: (typeof scores.criteria)[number]) => ((c.B - c.A) * c.weight) / 10;
    const byGap = [...scores.criteria].sort((x, y) => weightedGap(y) - weightedGap(x));
    expect(byGap[0]?.key).toBe("rebuttal");
    const rebuttal = scores.criteria.find((c) => c.key === "rebuttal");
    expect((rebuttal?.B ?? 0) - (rebuttal?.A ?? 0)).toBeGreaterThanOrEqual(3);
    // Chidi is not behind anywhere else, so the rebuttal is what lost it.
    for (const c of scores.criteria.filter((x) => x.key !== "rebuttal")) expect(c.A).toBeGreaterThanOrEqual(c.B);

    // Both passes (swapped order) picked tunde's side with at least 60% confidence; recorded as the mock model.
    const passes = await t.db.select().from(evaluationPasses).where(eq(evaluationPasses.competitionId, id));
    expect(passes.length).toBeGreaterThanOrEqual(2);
    expect(new Set(passes.map((p) => p.order))).toEqual(new Set(["AB", "BA"]));
    for (const p of passes) {
      expect(p.confidence ?? 0).toBeGreaterThanOrEqual(0.6);
      expect(p.provider).toBe("mock");
    }

    // Judged recently enough for chidi to appeal (48-hour window), and he has not.
    expect(Date.now() - (verdict?.createdAt.getTime() ?? 0)).toBeLessThan(6 * 60 * 60 * 1000);
    const chidiAppeals = await t.db.select().from(appeals).where(and(eq(appeals.competitionId, id), eq(appeals.appellantId, first.users.chidi ?? "missing")));
    expect(chidiAppeals).toHaveLength(0);
  });
});

describe("seed (accounts made by hand first)", () => {
  const t = setupTestDb({ resetBetweenTests: false });

  it(
    "reuses an existing users row for a demo email (case-insensitive), keeps its handle and sets the demo role",
    async () => {
      // As if chidi and ngozi signed up through the framework and finished /welcome before the seed ran.
      const [chidi] = await t.db
        .insert(users)
        .values({ name: "Chidi", email: "Chidi@ArgueIt.test", emailVerified: true, role: "user" })
        .returning({ id: users.id });
      const [ngozi] = await t.db
        .insert(users)
        .values({ name: "Ngozi", email: "ngozi@argueit.test", emailVerified: true, role: "user" })
        .returning({ id: users.id });
      if (!chidi || !ngozi) throw new Error("test setup failed");
      await t.db.insert(profiles).values({ userId: chidi.id, handle: "chidi_real", displayName: "Chidi O." });

      const summary = await seedDemo(t.db);
      expect(summary.users.chidi).toBe(chidi.id);
      expect(summary.users.mod).toBe(ngozi.id);
      expect(summary.created).toMatchObject({ users: 6, profiles: 7, appeals: 1 });

      const rows = await t.db.select({ id: users.id, email: users.email, role: users.role }).from(users);
      expect(rows).toHaveLength(demoEmails.length);
      expect(rows.find((r) => r.id === ngozi.id)?.role).toBe("moderator");
      const [chidiProfile] = await t.db.select().from(profiles).where(eq(profiles.userId, chidi.id));
      expect(chidiProfile?.handle).toBe("chidi_real");

      // The fixtures exist for the reused accounts too.
      const [narrow] = await t.db.select().from(verdicts).where(eq(verdicts.competitionId, summary.competitions.narrowLoss));
      expect(narrow?.outcome).toBe("B");
      expect(summary.warnings).toEqual([]);
    },
    SEED_TIMEOUT,
  );
});
