// Owner: 8-explainer-host (Task 11, Debate Host). "Sharpen with agent" on /new: the user types a raw hot take,
// the agent turns it into a clear proposition and calls prefill-argument, and the form pre-fills. The user
// publishes (create-argument); nothing here submits.
import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { Sparkles } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/argue/ui/button";
import { Card } from "@/components/argue/ui/card";
import { Input } from "@/components/argue/ui/input";
import { ARGUMENT_DRAFT_KEY } from "@domain/explain/rules";

import { useAgentDraft } from "./use-agent-draft";

export interface ArgumentDraftValue extends Record<string, unknown> {
  title: string;
  proposition: string | null;
  body: string;
  categorySlug: string;
  categoryName?: string;
  _writeId?: string;
}

export function isArgumentDraft(value: unknown): value is ArgumentDraftValue {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.title === "string" &&
    typeof v.body === "string" &&
    typeof v.categorySlug === "string" &&
    (v.proposition === undefined || v.proposition === null || typeof v.proposition === "string")
  );
}

/**
 * The latest agent draft for the new-argument form. Once a draft arrives it is kept in local state and removed
 * from app state, so it pre-fills this form once and never a later visit. Pass `formKey` as the form's React
 * `key` and `initial` as its initial values: a new draft remounts the form with the new values.
 */
export function useAppliedArgumentDraft(): {
  formKey: string;
  initial: { title: string; proposition: string; body: string; categorySlug: string } | undefined;
  drafted: boolean;
} {
  const { draft, clear } = useAgentDraft<ArgumentDraftValue>(ARGUMENT_DRAFT_KEY, isArgumentDraft);
  const [applied, setApplied] = useState<ArgumentDraftValue | null>(null);
  useEffect(() => {
    if (!draft) return;
    setApplied(draft);
    void clear();
  }, [draft, clear]);
  if (!applied) return { formKey: "blank", initial: undefined, drafted: false };
  return {
    formKey: `agent-${applied._writeId ?? applied.title}`,
    initial: {
      title: applied.title,
      proposition: applied.proposition ?? "",
      body: applied.body,
      categorySlug: applied.categorySlug,
    },
    drafted: true,
  };
}

export function SharpenWithAgent({ drafted = false }: { drafted?: boolean }) {
  const [take, setTake] = useState("");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = take.trim();
    if (!text) return;
    sendToAgentChat({
      message: `Sharpen my hot take into a debate: ${text}`,
      context:
        "New-argument page (/new). Use list-categories, then prefill-argument with a title, a single arguable proposition, a short body in my voice and the category. Don't publish it.",
      submit: true,
      openSidebar: true,
    });
  }

  return (
    <Card tone="inset" className="mb-6 flex flex-col gap-3">
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Input
            label="Got a hot take?"
            hint="Type it however it comes out. The agent turns it into a clear claim and fills in the form below."
            value={take}
            onChange={(e) => setTake(e.target.value)}
            placeholder="osimhen > lookman"
            maxLength={500}
          />
        </div>
        <Button type="submit" variant="secondary" icon={<Sparkles aria-hidden className="size-4" />} disabled={!take.trim()}>
          Sharpen with agent
        </Button>
      </form>
      {drafted ? (
        <p role="status" className="text-sm font-semibold text-ink">
          Drafted by the agent: check it and edit anything before you publish.
        </p>
      ) : null}
    </Card>
  );
}
