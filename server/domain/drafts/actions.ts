/**
 * Thin `ActionResult` wrappers around the drafts service, in the same shape as the reference server actions
 * (auth → service → ok), so the Agent-Native actions can unwrap them with `runDomain`.
 * The service re-checks the role itself; `requireRole` here also refuses signed-out and suspended callers.
 */
import { runAction } from "@domain/action";
import { requireRole } from "@domain/auth";
import { ok, type ActionResult } from "@domain/lib/action-result";
import {
  approveDraft,
  checkDraftForDecision,
  discardDecisionDraft,
  getReviewCase,
  listDecisionDrafts,
  saveDecisionDraft,
  type DraftDecision,
  type DraftListItem,
  type DraftTarget,
  type DraftView,
  type ListDraftsInput,
  type ReviewCase,
  type SaveDraftInput,
} from "./service";

export async function getReviewCaseAction(input: DraftTarget): Promise<ActionResult<ReviewCase>> {
  return runAction(async () => ok(await getReviewCase(await requireRole("moderator"), input)));
}

export async function saveDecisionDraftAction(input: SaveDraftInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => ok(await saveDecisionDraft(await requireRole("moderator"), input)));
}

export async function listDecisionDraftsAction(input: ListDraftsInput = {}): Promise<ActionResult<DraftListItem[]>> {
  return runAction(async () => ok(await listDecisionDrafts(await requireRole("moderator"), input)));
}

export async function discardDecisionDraftAction(draftId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => ok(await discardDecisionDraft(await requireRole("moderator"), draftId)));
}

export async function checkDraftForDecisionAction(
  draftId: string,
  decision: DraftDecision,
): Promise<ActionResult<DraftView>> {
  return runAction(async () => ok(await checkDraftForDecision(await requireRole("moderator"), draftId, decision)));
}

export async function approveDraftAction(
  draftId: string,
  finalNote: string,
  decision: DraftDecision,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await approveDraft(await requireRole("moderator"), draftId, finalNote, decision);
    return ok();
  });
}

/**
 * For decide-appeal / resolve-review / retry-evaluation: pre-check the draft, run the human decision unchanged,
 * then mark the draft approved. Without a draftId it just runs the decision.
 */
export async function decideWithOptionalDraft<T>(
  draftId: string | undefined,
  decision: DraftDecision,
  finalNote: string,
  decide: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  if (!draftId) return decide();
  const checked = await checkDraftForDecisionAction(draftId, decision);
  if (!checked.ok) return checked;
  const result = await decide();
  if (!result.ok) return result;
  const approved = await approveDraftAction(draftId, finalNote, decision);
  if (!approved.ok) {
    // The decision itself went through; report the draft bookkeeping failure without hiding the decision.
    console.error("[drafts] decision saved but the draft could not be marked approved", { draftId, approved });
  }
  return result;
}
