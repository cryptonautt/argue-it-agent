/**
 * Owner: verdict. Pure appeal-eligibility rules (design §4.4). No DB, no clock: callers pass `at`.
 *
 * Rules:
 * - Only the two participants may appeal, once each per competition (also a DB unique constraint).
 * - Only a completed competition with a current verdict can be appealed.
 * - One appeal is reviewed at a time; while one is open the competition is `under_appeal`.
 * - The window is 48h from the window anchor: the current verdict's creation time, or — if an appeal
 *   against that same verdict was upheld — the moment it was upheld. That way an opponent who waited for
 *   the first appeal to be decided is not timed out by the review itself.
 */
import { addHours } from "@domain/lib/time";
import type { AppealStatus, CompetitionStatus } from "@domain/db/schema";
import { APPEAL_WINDOW_HOURS } from "./rules";

export interface EligibilityAppeal {
  id: string;
  appellantId: string;
  verdictId: string;
  status: AppealStatus;
  decidedAt: Date | null;
}

export interface EligibilityInput {
  viewerId: string | null;
  participantIds: readonly string[];
  competitionStatus: CompetitionStatus;
  currentVerdict: { id: string; createdAt: Date } | null;
  appeals: readonly EligibilityAppeal[];
  at: Date;
}

export type IneligibleReason =
  | "signed_out"
  | "not_participant"
  | "no_verdict"
  | "appeal_in_progress"
  | "already_appealed"
  | "window_closed";

export type AppealEligibility =
  | { eligible: true; closesAt: Date }
  | { eligible: false; reason: IneligibleReason; closesAt: Date | null; message: string };

export function appealWindowAnchor(
  verdict: { id: string; createdAt: Date },
  appeals: readonly EligibilityAppeal[],
): Date {
  let anchor = verdict.createdAt;
  for (const appeal of appeals) {
    if (appeal.verdictId === verdict.id && appeal.status === "upheld" && appeal.decidedAt && appeal.decidedAt > anchor) {
      anchor = appeal.decidedAt;
    }
  }
  return anchor;
}

export function appealWindowClosesAt(
  verdict: { id: string; createdAt: Date },
  appeals: readonly EligibilityAppeal[],
): Date {
  return addHours(appealWindowAnchor(verdict, appeals), APPEAL_WINDOW_HOURS);
}

const STATUS_MESSAGES: Partial<Record<CompetitionStatus, string>> = {
  under_appeal: "An appeal on this verdict is being reviewed. You'll be notified when it's decided.",
  evaluating: "The AI judge is still working on this debate.",
  needs_review: "A human reviewer is checking this result before it's final.",
};

export function getAppealEligibility(input: EligibilityInput): AppealEligibility {
  const { viewerId, participantIds, competitionStatus, currentVerdict, appeals, at } = input;
  const closesAt = currentVerdict ? appealWindowClosesAt(currentVerdict, appeals) : null;
  const no = (reason: IneligibleReason, message: string): AppealEligibility => ({
    eligible: false,
    reason,
    closesAt,
    message,
  });

  if (!viewerId) return no("signed_out", "Sign in to appeal.");
  if (!participantIds.includes(viewerId)) return no("not_participant", "Only the two debaters can appeal a verdict.");

  const own = appeals.find((a) => a.appellantId === viewerId);
  if (own) return no("already_appealed", "You've already used your one appeal for this debate.");

  if (competitionStatus === "under_appeal" || appeals.some((a) => a.status === "open")) {
    return no("appeal_in_progress", STATUS_MESSAGES.under_appeal ?? "");
  }
  if (competitionStatus !== "completed" || !currentVerdict || !closesAt) {
    return no("no_verdict", STATUS_MESSAGES[competitionStatus] ?? "There's no verdict to appeal yet.");
  }
  if (at.getTime() >= closesAt.getTime()) {
    return no("window_closed", `Appeals close ${APPEAL_WINDOW_HOURS} hours after the verdict. This window has closed.`);
  }
  return { eligible: true, closesAt };
}
