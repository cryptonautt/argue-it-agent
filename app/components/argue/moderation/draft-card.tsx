// Owner: 7-moderator-agent (plan Task 8). The agent drafts a moderation decision; a human approves it here.
//
// - <TriageQueueButton/>: asks the agent to draft every item in the review queue.
// - <AgentDraftSlot kind targetId title/>: per-item "Draft with agent" button + the open draft (if any).
// - <DraftCard/>: recommendation, confidence, editable note, citations grouped by side, Approve / Discard.
// - <ApprovedDraftsList/>: recently approved drafts, each marked as edited by the moderator or approved as drafted.
//
// Every write carries the explicit target id, and the card shows the target's title from the server so the
// moderator can see which record the draft is for (Review Focus #1). Approving calls decide-appeal /
// resolve-review / retry-evaluation with the draftId: the same actions the manual forms use.
// Only TYPES come from the drafts service, so nothing here pulls server code into the client bundle.
import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { Bot, Check, PencilLine, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Badge, type BadgeTone } from "@/components/argue/ui/badge";
import { Button } from "@/components/argue/ui/button";
import { Textarea } from "@/components/argue/ui/textarea";
import { useToast } from "@/components/argue/ui/toast";
import { toActionFailure } from "@/lib/server-actions";
import { useRouter } from "@/shims/next-navigation";
import type { DraftListItem } from "@domain/drafts/service";

export type DraftKind = "appeal" | "review";

const MIN_NOTE = 10;
const MAX_NOTE = 1000;

const RECOMMENDATION_LABELS: Record<string, string> = {
  uphold: "Uphold: the verdict stands",
  reevaluate: "Re-evaluate: run the AI judge once more",
  overturn: "Overturn: change the result",
  A: "Side A (FOR) wins",
  B: "Side B (AGAINST) wins",
  draw: "Draw",
  inconclusive: "Confirm inconclusive (no winner)",
  retry: "Retry the failed evaluation",
};

const OUTCOME_LABELS: Record<string, string> = {
  A: "Side A (FOR) wins",
  B: "Side B (AGAINST) wins",
  draw: "Draw",
  inconclusive: "Inconclusive",
};

const CONFIDENCE_TONE: Record<string, BadgeTone> = { low: "warning", medium: "neutral", high: "success" };

const SIDE_LABEL = { A: "Side A (FOR)", B: "Side B (AGAINST)" } as const;

/** The agent-chat message for one item. Exported for tests. */
export function draftRequest(kind: DraftKind, targetId: string, title: string) {
  return {
    message: `Draft a decision for this ${kind}`,
    context: `${kind} id: ${targetId}\nDebate: ${title}`,
    submit: true,
    openSidebar: true,
  } as const;
}

export const TRIAGE_REQUEST = {
  message: "Triage the review queue",
  context:
    "Use the moderation-drafting skill: for each item in list-review-queue, get-review-case then save-decision-draft. Draft only; do not decide.",
  submit: true,
  openSidebar: true,
} as const;

export function TriageQueueButton() {
  return (
    <Button variant="judge" size="sm" icon={<Sparkles aria-hidden className="size-4" />} onClick={() => sendToAgentChat(TRIAGE_REQUEST)}>
      Triage queue
    </Button>
  );
}

/** What Approve sends: the action name and its input. Exported for tests. */
export function approvalCall(
  draft: Pick<DraftListItem, "id" | "kind" | "targetId" | "recommendation" | "outcome">,
  note: string,
  idempotencyKey: string,
): { action: "decide-appeal" | "resolve-review" | "retry-evaluation"; input: Record<string, unknown> } {
  const draftId = draft.id;
  if (draft.kind === "appeal") {
    return {
      action: "decide-appeal",
      input: {
        appealId: draft.targetId,
        decision: draft.recommendation,
        ...(draft.recommendation === "overturn" ? { outcome: draft.outcome } : {}),
        note,
        draftId,
        idempotencyKey,
      },
    };
  }
  if (draft.recommendation === "retry") {
    return { action: "retry-evaluation", input: { competitionId: draft.targetId, draftId, idempotencyKey } };
  }
  return {
    action: "resolve-review",
    input: { competitionId: draft.targetId, outcome: draft.recommendation, note, draftId, idempotencyKey },
  };
}

export function DraftCard({
  draft,
  expectedTitle,
  onDone,
}: {
  draft: DraftListItem;
  /** The title of the queue item this card sits under; a mismatch blocks approval. */
  expectedTitle?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [note, setNote] = useState(draft.note);
  const [noteError, setNoteError] = useState<string | undefined>();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"approve" | "discard" | null>(null);

  useEffect(() => {
    setNote(draft.note);
    setKey(crypto.randomUUID());
  }, [draft.id, draft.note]);

  const wrongTarget = expectedTitle !== undefined && expectedTitle !== draft.target.title;
  const isRetry = draft.recommendation === "retry";
  const canApprove = draft.status === "draft" && draft.target.open && !wrongTarget;
  const bySide = {
    A: draft.citations.filter((c) => c.side === "A"),
    B: draft.citations.filter((c) => c.side === "B"),
  };

  function finish(message: string) {
    success(message);
    onDone?.();
    router.refresh();
  }

  function approve() {
    const trimmed = note.trim();
    if (!isRetry && (trimmed.length < MIN_NOTE || trimmed.length > MAX_NOTE)) {
      setNoteError(`The note must be ${MIN_NOTE} to ${MAX_NOTE} characters. Both debaters read it.`);
      return;
    }
    setNoteError(undefined);
    const call = approvalCall(draft, trimmed, key);
    setBusy("approve");
    startTransition(async () => {
      try {
        await callAction<unknown>(call.action as never, call.input as never);
        setKey(crypto.randomUUID());
        finish("Decision saved from the agent's draft. Both debaters have been notified.");
      } catch (e) {
        error(toActionFailure(e).error);
      } finally {
        setBusy(null);
      }
    });
  }

  function discard() {
    setBusy("discard");
    startTransition(async () => {
      try {
        await callAction<unknown>("discard-decision-draft" as never, { id: draft.id } as never);
        finish("Draft discarded.");
      } catch (e) {
        error(toActionFailure(e).error);
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <section
      data-draft-id={draft.id}
      aria-label="Agent draft"
      className="flex flex-col gap-3 rounded-[var(--radius)] border border-dashed border-line-strong bg-surface-2 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Bot aria-hidden className="size-4" />
          Drafted by the agent: check before approving
        </p>
        <Badge tone={CONFIDENCE_TONE[draft.confidence] ?? "neutral"}>Confidence: {draft.confidence}</Badge>
      </div>

      <p className="text-sm text-ink-2">
        For the {draft.kind === "appeal" ? "appeal on" : "review of"}: <span className="font-semibold text-ink">{draft.target.title}</span>
      </p>
      {wrongTarget ? (
        <p role="alert" className="text-sm font-medium text-danger">
          This draft is for a different debate than the one above. Discard it and draft again.
        </p>
      ) : null}
      {!draft.target.open ? (
        <p role="alert" className="text-sm font-medium text-danger">
          This {draft.kind} has already been decided. The draft can only be discarded.
        </p>
      ) : null}

      <p className="text-base font-semibold text-ink">
        {RECOMMENDATION_LABELS[draft.recommendation] ?? draft.recommendation}
        {draft.recommendation === "overturn" && draft.outcome ? ` → ${OUTCOME_LABELS[draft.outcome] ?? draft.outcome}` : null}
      </p>

      {isRetry ? (
        <p className="whitespace-pre-wrap text-sm text-ink">{draft.note}</p>
      ) : (
        <Textarea
          label="Written reason (edit before approving; shown to both debaters)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={MAX_NOTE}
          showCount
          rows={4}
          required
          error={noteError}
        />
      )}

      {draft.citations.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["A", "B"] as const).map((side) => (
            <div key={side}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{SIDE_LABEL[side]}</p>
              {bySide[side].length === 0 ? (
                <p className="text-sm text-ink-3">No quotes cited.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {bySide[side].map((c, i) => (
                    <li key={`${side}-${i}`} className="text-sm text-ink">
                      <blockquote className="border-l-2 border-line-strong pl-2 italic">&ldquo;{c.quote}&rdquo;</blockquote>
                      <span className="text-xs text-ink-3">{c.criterion}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 aria-hidden className="size-4" />}
          loading={pending && busy === "discard"}
          disabled={pending || draft.status !== "draft"}
          onClick={discard}
        >
          Discard
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={<Check aria-hidden className="size-4" />}
          loading={pending && busy === "approve"}
          disabled={pending || !canApprove}
          onClick={approve}
        >
          Approve
        </Button>
      </div>
    </section>
  );
}

/** Per-queue-item slot: "Draft with agent" button and the item's open draft, if any. */
export function AgentDraftSlot({ kind, targetId, title }: { kind: DraftKind; targetId: string; title: string }) {
  const query = useActionQuery(
    "list-decision-drafts",
    { status: "draft", kind, targetId },
    { refetchInterval: 15_000 } as never,
  );
  const drafts = (query.data ?? []) as DraftListItem[];
  const draft = drafts.find((d) => d.kind === kind && d.targetId === targetId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          icon={<Bot aria-hidden className="size-4" />}
          onClick={() => sendToAgentChat(draftRequest(kind, targetId, title))}
        >
          {draft ? "Redraft with agent" : "Draft with agent"}
        </Button>
        <p className="text-xs text-ink-3">The agent drafts; you decide.</p>
      </div>
      {draft ? <DraftCard draft={draft} expectedTitle={title} onDone={() => void query.refetch()} /> : null}
    </div>
  );
}

/** How an approved draft became a decision: the badge the approved list shows. Exported for tests. */
export function draftProvenance(draft: Pick<DraftListItem, "edited">): { label: string; tone: BadgeTone } {
  return draft.edited
    ? { label: "Edited by the moderator before approving", tone: "warning" }
    : { label: "Approved as the agent drafted it", tone: "success" };
}

/** Recently approved agent drafts, so the moderator (and the demo) can see where a human changed the agent's note. */
export function ApprovedDraftsList({ limit = 5 }: { limit?: number }) {
  const query = useActionQuery("list-decision-drafts", { status: "approved" }, { refetchInterval: 15_000 } as never);
  const drafts = ((query.data ?? []) as DraftListItem[]).slice(0, limit);
  if (drafts.length === 0) return null;

  return (
    <section aria-labelledby="approved-drafts" className="flex flex-col gap-3 pb-12">
      <h2 id="approved-drafts" className="flex items-center gap-2 text-2xl text-ink">
        <Bot aria-hidden className="size-5" />
        Agent drafts you approved
      </h2>
      <ul className="flex flex-col divide-y divide-line rounded-[var(--radius)] border border-line bg-surface">
        {drafts.map((draft) => {
          const provenance = draftProvenance(draft);
          return (
            <li key={draft.id} data-draft-id={draft.id} className="flex flex-col gap-1 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate font-semibold text-ink">{draft.target.title}</span>
                <Badge tone={provenance.tone}>
                  {draft.edited ? <PencilLine aria-hidden className="mr-1 inline size-3" /> : null}
                  {provenance.label}
                </Badge>
              </div>
              <p className="text-ink-2">
                {draft.kind === "appeal" ? "Appeal" : "Review"} &middot;{" "}
                {RECOMMENDATION_LABELS[draft.recommendation] ?? draft.recommendation}
              </p>
              {draft.recommendation === "retry" ? null : (
                <p className="text-ink-3">
                  {draft.edited ? "The agent's original note: " : "Note: "}
                  {draft.note}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
