import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import { navFromCommand, toNavigationState, type ArgueNav } from "../app/hooks/navigation-map";

/**
 * Builds the agent's <current-screen> block on every turn, so it must never throw: every domain lookup is
 * wrapped and the action falls back to plain navigation. Domain modules are imported lazily for the same
 * reason (a failing import must not take the whole action down).
 */

type Visible = Record<string, unknown>;

async function viewer() {
  const auth = await import("@domain/auth");
  return auth.getSession();
}

async function verdictSummary(competitionId: string): Promise<Visible | null> {
  const { getVerdictPageData } = await import("@domain/appeals/queries");
  const data = await getVerdictPageData(competitionId, await viewer());
  if (!data) return { notFound: true, competitionId };
  const current = data.current;
  return {
    competitionId,
    proposition: data.proposition,
    category: data.category.name,
    status: data.status,
    sides: {
      A: { name: data.sides.A.displayName, handle: data.sides.A.handle, stance: data.sides.A.stance },
      B: { name: data.sides.B.displayName, handle: data.sides.B.handle, stance: data.sides.B.stance },
    },
    outcome: current?.outcome ?? null,
    winnerSide: current?.outcomeView.winnerSide ?? null,
    headline: current?.outcomeView.headline ?? null,
    decidedBy: current?.decidedBy ?? null,
    confidence: current?.confidenceLabel ?? null,
    totals: current?.scores?.totals ?? null,
    criteria:
      current?.scores?.criteria.map((c) => ({ key: c.key, label: c.label, weight: c.weight, A: c.A, B: c.B })) ?? [],
    appealDeadline: data.eligibility.closesAt,
    viewerCanAppeal: data.eligibility.eligible,
    viewerSide: data.viewer.side,
    openAppeals: data.appeals.filter((a) => a.status === "open").map((a) => ({ id: a.id, ground: a.ground })),
  };
}

async function debateSummary(competitionId: string): Promise<Visible | null> {
  const { loadCompetitionCore } = await import("@domain/appeals/core");
  const core = await loadCompetitionCore(competitionId);
  if (!core) return { notFound: true, competitionId };
  return {
    competitionId,
    proposition: core.competition.rulesSnapshot.proposition,
    category: core.category.name,
    status: core.competition.status,
    round: core.competition.round,
    sides: {
      A: { name: core.sides.A.displayName, handle: core.sides.A.handle, stance: core.sides.A.stance },
      B: { name: core.sides.B.displayName, handle: core.sides.B.handle, stance: core.sides.B.stance },
    },
  };
}

async function argumentSummary(argumentId: string): Promise<Visible | null> {
  const { getArgumentDetail } = await import("@domain/arguments/queries");
  const user = await viewer();
  const detail = await getArgumentDetail(argumentId, user?.id ?? null);
  if (!detail) return { notFound: true, argumentId };
  if (detail.status !== "visible") return { argumentId, status: detail.status };
  return {
    argumentId,
    title: detail.title,
    proposition: detail.proposition,
    category: detail.category.name,
    author: detail.author,
    locked: detail.locked,
  };
}

async function reviewQueueSummary(tab: "review" | "appeals"): Promise<Visible | null> {
  const user = await viewer();
  const { hasRole } = await import("@domain/auth/roles");
  // Staff-only data: a non-moderator on this URL sees nothing from the queue.
  if (!user || !hasRole(user.role, "moderator")) return { staffOnly: true };
  const { getAppealQueue, getReviewQueue } = await import("@domain/appeals/queries");
  const [review, appeals] = await Promise.all([getReviewQueue(), getAppealQueue({ recentLimit: 0 })]);
  return {
    tab,
    counts: { review: review.length, appeals: appeals.open.length },
    firstReview: review.slice(0, 5).map((item) => ({
      kind: "review",
      competitionId: item.header.competitionId,
      proposition: item.header.proposition,
    })),
    firstAppeals: appeals.open.slice(0, 5).map((item) => ({
      kind: "appeal",
      appealId: item.appeal.id,
      competitionId: item.header.competitionId,
      proposition: item.header.proposition,
      ground: item.appeal.ground,
    })),
  };
}

async function visibleFor(nav: ArgueNav): Promise<Visible | null> {
  switch (nav.view) {
    case "verdict":
      return verdictSummary(nav.competitionId);
    case "debate":
      return debateSummary(nav.competitionId);
    case "argument":
      return argumentSummary(nav.argumentId);
    case "review-queue":
      return reviewQueueSummary(nav.tab);
    default:
      return null;
  }
}

function navFromState(navigation: unknown): ArgueNav | null {
  if (!navigation || typeof navigation !== "object") return null;
  try {
    // The UI hook writes ARGUE views with their ids ({ view: "verdict", competitionId, … }).
    const fromView = navFromCommand(navigation as Record<string, string>);
    if (fromView) return fromView;
  } catch {
    // fall through to the path
  }
  const n = navigation as { path?: unknown };
  const path = typeof n.path === "string" ? n.path : null;
  if (!path) return null;
  const [pathname, query] = path.split("?");
  return toNavigationState(pathname ?? "/", query);
}

export default defineAction({
  description:
    "Read the user's current ARGUE IT screen: { navigation, visible }. `visible` summarises the record on screen " +
    "(verdict: proposition, outcome, winner side, per-criterion scores, appeal deadline; review queue: counts and the " +
    "first 5 item ids). Basic navigation is already in <current-screen>; call this for a fresh read.",
  schema: z.object({}),
  outputSchema: z.union([
    z.object({ navigation: z.unknown().optional(), visible: z.record(z.string(), z.unknown()).nullable().optional() }),
    z.string(),
  ]),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = await readAppState("navigation");
    if (!navigation) return "No application state found. Is the app running?";

    const nav = navFromState(navigation);
    if (!nav) return { navigation };
    try {
      return { navigation, visible: await visibleFor(nav) };
    } catch (error) {
      console.warn("[view-screen] could not summarise the screen", error);
      return { navigation, visible: null };
    }
  },
});
