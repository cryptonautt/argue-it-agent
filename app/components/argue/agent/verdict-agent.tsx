// Owner: 8-explainer-host (Task 10, Verdict Explainer). Small pieces the verdict page mounts at agent 5b's slots:
// "Ask why" per criterion, "Help me appeal", the agent-drafted appeal reader, and the recorded-model line.
// Client-only: no runtime @domain import except the pure explain/rules module.
import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { MessageCircleQuestion, Sparkles } from "lucide-react";

import { Button } from "@/components/argue/ui/button";
import type { AppealGround } from "@domain/db/schema";
import { APPEAL_GROUND_VALUES } from "@domain/appeals/rules";
import { APPEAL_DRAFT_KEY } from "@domain/explain/rules";

import { useAgentDraft } from "./use-agent-draft";

export function AskWhyButton({
  competitionId,
  criterion,
}: {
  competitionId: string;
  criterion: { key: string; label: string };
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<MessageCircleQuestion aria-hidden className="size-4" />}
      onClick={() =>
        sendToAgentChat({
          message: `Why did I get this score on ${criterion.label}?`,
          context: `Verdict page. competitionId: ${competitionId}. Criterion: ${criterion.key} (${criterion.label}). Explain it with get-verdict-explanation, quoting both sides.`,
          submit: true,
          openSidebar: true,
        })
      }
    >
      Ask why
    </Button>
  );
}

export function HelpMeAppealButton({ competitionId }: { competitionId: string }) {
  return (
    <Button
      variant="secondary"
      icon={<Sparkles aria-hidden className="size-4" />}
      onClick={() =>
        sendToAgentChat({
          message: "Help me appeal this verdict",
          context: `Verdict page. competitionId: ${competitionId}. Check appeal eligibility with get-verdict-explanation; if a valid ground fits the evidence, use prefill-appeal. Don't submit it.`,
          submit: true,
          openSidebar: true,
        })
      }
    >
      Help me appeal
    </Button>
  );
}

export interface AppealDraftValue extends Record<string, unknown> {
  competitionId: string;
  ground: AppealGround;
  statement: string;
  _writeId?: string;
}

const GROUNDS = new Set<string>(APPEAL_GROUND_VALUES);

/** Accept only a well-formed draft for THIS debate (never pre-fill another debate's form). */
export function isAppealDraftFor(competitionId: string) {
  return (value: unknown): value is AppealDraftValue => {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return (
      v.competitionId === competitionId &&
      typeof v.ground === "string" &&
      GROUNDS.has(v.ground) &&
      typeof v.statement === "string"
    );
  };
}

/** The agent-drafted appeal for this debate (from prefill-appeal), if any. */
export function useAppealDraft(competitionId: string) {
  return useAgentDraft<AppealDraftValue>(APPEAL_DRAFT_KEY, isAppealDraftFor(competitionId));
}

/**
 * "Judged by <model> · N passes", read from the stored pass rows through get-verdict-explanation
 * (Task 10 Step 3b). Null while loading, on error, or when no passes are stored.
 */
export function useJudgedBy(competitionId: string): string | null {
  const query = useActionQuery("get-verdict-explanation", { competitionId }, { retry: false });
  const data = query.data as { judgedBy?: string | null } | undefined;
  return data?.judgedBy ?? null;
}
