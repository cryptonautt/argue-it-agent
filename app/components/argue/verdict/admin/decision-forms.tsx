"use client";

// Owner: verdict. Reviewer decision forms for /admin/appeals and /admin/review. Every decision needs a
// written reason — both debaters see it.
import { useRouter } from "@/shims/next-navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/argue/ui/button";
import { Textarea } from "@/components/argue/ui/textarea";
import { useToast } from "@/components/argue/ui/toast";
import { cn } from "@domain/lib/cn";
import type { FieldErrors } from "@domain/lib/action-result";
import { decideAppeal, resolveReview, retryFailedEvaluation, retryReputation } from "@domain/lib/server-actions";
import { APPEAL_DECISIONS, DECISION_NOTE_MAX, type AppealDecision } from "@domain/appeals/rules";
import type { VerdictOutcome } from "@domain/db/schema";

type HumanOutcome = "A" | "B" | "draw" | "inconclusive";

const OUTCOME_OPTIONS: ReadonlyArray<{ value: HumanOutcome; label: string }> = [
  { value: "A", label: "Side A (FOR) wins" },
  { value: "B", label: "Side B (AGAINST) wins" },
  { value: "draw", label: "Draw" },
  { value: "inconclusive", label: "Inconclusive (no winner)" },
];

function RadioCards<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  error,
}: {
  legend: string;
  name: string;
  options: ReadonlyArray<{ value: T; label: string; description?: string; disabled?: boolean; disabledReason?: string }>;
  value: T | null;
  onChange: (value: T) => void;
  error?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-ink">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const id = `${name}-${o.value}`;
          return (
            <label
              key={o.value}
              htmlFor={id}
              className={cn(
                "flex gap-2.5 rounded-[var(--radius)] border p-3 text-sm",
                o.disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:bg-surface-2",
                value === o.value ? "border-ink bg-surface-2" : "border-line-strong",
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={o.value}
                checked={value === o.value}
                disabled={o.disabled}
                onChange={() => onChange(o.value)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]"
              />
              <span>
                <span className="block font-semibold text-ink">{o.label}</span>
                {o.description ? <span className="block text-ink-2">{o.description}</span> : null}
                {o.disabled && o.disabledReason ? <span className="block text-ink-3">{o.disabledReason}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function RatingsWarning({ competitionId }: { competitionId: string }) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-[var(--radius)] bg-warning-soft p-3 text-sm text-ink">
      <p>The decision was saved, but ratings couldn&rsquo;t be updated. Retry so the leaderboard stays correct.</p>
      <div>
        <RetryRatingsButton competitionId={competitionId} />
      </div>
    </div>
  );
}

export function AppealDecisionForm({
  appealId,
  competitionId,
  currentOutcome,
  reevaluationBlockedReason,
}: {
  appealId: string;
  competitionId: string;
  currentOutcome: VerdictOutcome | null;
  /** Null when re-evaluation is allowed. */
  reevaluationBlockedReason: string | null;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const name = useId();
  const [decision, setDecision] = useState<AppealDecision | null>(null);
  const [outcome, setOutcome] = useState<HumanOutcome | null>(null);
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [ratingsFailed, setRatingsFailed] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!decision) return setFieldErrors({ decision: ["Choose a decision."] });
    let input: Parameters<typeof decideAppeal>[0];
    if (decision === "overturn") {
      if (!outcome) return setFieldErrors({ outcome: ["Choose the new outcome."] });
      input = { appealId, decision, outcome, note, idempotencyKey: key };
    } else {
      input = { appealId, decision, note, idempotencyKey: key };
    }
    setFieldErrors({});
    startTransition(async () => {
      const result = await decideAppeal(input);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        error(result.error);
        return;
      }
      setKey(crypto.randomUUID());
      if (result.data.ratingsUpdated === false) setRatingsFailed(true);
      success("Decision saved. Both debaters have been notified.");
      router.refresh();
    });
  }

  if (ratingsFailed) return <RatingsWarning competitionId={competitionId} />;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <RadioCards
        legend="Decision"
        name={`${name}-decision`}
        value={decision}
        onChange={setDecision}
        error={fieldErrors.decision?.[0]}
        options={APPEAL_DECISIONS.map((d) => ({
          value: d.value,
          label: d.label,
          description: d.description,
          disabled: d.value === "reevaluate" && reevaluationBlockedReason !== null,
          disabledReason: d.value === "reevaluate" ? (reevaluationBlockedReason ?? undefined) : undefined,
        }))}
      />
      {decision === "overturn" ? (
        <RadioCards
          legend="New outcome"
          name={`${name}-outcome`}
          value={outcome}
          onChange={setOutcome}
          error={fieldErrors.outcome?.[0]}
          options={OUTCOME_OPTIONS.map((o) => ({
            ...o,
            disabled: o.value === currentOutcome,
            disabledReason: o.value === currentOutcome ? "Current outcome" : undefined,
          }))}
        />
      ) : null}
      <Textarea
        label="Written reason (shown to both debaters)"
        hint="Explain which ground was or wasn't made out, citing the submission or verdict."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={DECISION_NOTE_MAX}
        showCount
        rows={4}
        required
        error={fieldErrors.note}
      />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending}>
          Save decision
        </Button>
      </div>
    </form>
  );
}

export function ReviewDecisionForm({ competitionId }: { competitionId: string }) {
  const router = useRouter();
  const { success, error } = useToast();
  const name = useId();
  const [outcome, setOutcome] = useState<HumanOutcome | null>(null);
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [ratingsFailed, setRatingsFailed] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!outcome) return setFieldErrors({ outcome: ["Choose an outcome."] });
    setFieldErrors({});
    startTransition(async () => {
      const result = await resolveReview({ competitionId, outcome, note, idempotencyKey: key });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        error(result.error);
        return;
      }
      setKey(crypto.randomUUID());
      if (!result.data.ratingsUpdated) setRatingsFailed(true);
      success("Result published. Both debaters have been notified.");
      router.refresh();
    });
  }

  if (ratingsFailed) return <RatingsWarning competitionId={competitionId} />;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <RadioCards
        legend="Outcome"
        name={`${name}-outcome`}
        value={outcome}
        onChange={setOutcome}
        error={fieldErrors.outcome?.[0]}
        options={OUTCOME_OPTIONS.map((o) =>
          o.value === "inconclusive"
            ? { ...o, label: "Confirm inconclusive", description: "No winner; ratings don't change." }
            : o,
        )}
      />
      <Textarea
        label="Written reason (shown to both debaters)"
        hint="Apply the same rubric the AI used. Don't pick a winner unless the case is clear."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={DECISION_NOTE_MAX}
        showCount
        rows={4}
        required
        error={fieldErrors.note}
      />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending}>
          Publish result
        </Button>
      </div>
    </form>
  );
}

export function RetryEvaluationButton({ competitionId }: { competitionId: string }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await retryFailedEvaluation({ competitionId, idempotencyKey: key });
          if (!result.ok) return error(result.error);
          setKey(crypto.randomUUID());
          success("Evaluation queued again.");
          router.refresh();
        })
      }
    >
      Retry the AI evaluation
    </Button>
  );
}

export function RetryRatingsButton({ competitionId }: { competitionId: string }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await retryReputation({ competitionId, idempotencyKey: key });
          setKey(crypto.randomUUID());
          if (!result.ok) return error(result.error);
          if (!result.data.ratingsUpdated) return error("Ratings still couldn't be updated. Check the server logs.");
          success("Ratings updated.");
          router.refresh();
        })
      }
    >
      Retry rating update
    </Button>
  );
}
