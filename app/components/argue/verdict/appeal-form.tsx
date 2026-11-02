"use client";

// Owner: verdict. The appeal form: pick a ground, explain what went wrong, confirm you understand it's one-shot.
import { useRouter } from "@/shims/next-navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { CircleAlert, Scale } from "lucide-react";
import { Button } from "@/components/argue/ui/button";
import { Countdown } from "@/components/argue/ui/countdown";
import { Textarea } from "@/components/argue/ui/textarea";
import { useToast } from "@/components/argue/ui/toast";
import { cn } from "@domain/lib/cn";
import type { FieldErrors } from "@domain/lib/action-result";
import { fileAppeal } from "@domain/lib/server-actions";
import { APPEAL_GROUNDS, APPEAL_TEXT_MAX, APPEAL_TEXT_MIN, NOT_A_GROUND } from "@domain/appeals/rules";
import type { AppealGround } from "@domain/db/schema";

export interface AppealFormProps {
  competitionId: string;
  /** ISO time the appeal window closes. */
  closesAt: string;
}

export function AppealForm({ competitionId, closesAt }: AppealFormProps) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [ground, setGround] = useState<AppealGround | null>(null);
  const [text, setText] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const groundName = useId();
  const understoodId = useId();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ground) {
      setFieldErrors({ ground: ["Pick the ground that fits your appeal."] });
      return;
    }
    if (!understood) {
      setFieldErrors({ understood: ["Please confirm you understand how appeals work."] });
      return;
    }
    setFieldErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = await fileAppeal({ competitionId, ground, text, idempotencyKey: key });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        error(result.error);
        return;
      }
      setKey(crypto.randomUUID());
      success("Appeal sent. A reviewer will look at it.");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">
          Think the judge made a mistake? You get <strong>one appeal</strong> for this debate.{" "}
          <Countdown deadline={closesAt} label="Appeals close in" expiredLabel="The appeal window has closed" />
        </p>
        <div>
          <Button variant="secondary" icon={<Scale aria-hidden className="size-4" />} onClick={() => setOpen(true)}>
            Appeal this verdict
          </Button>
        </div>
      </div>
    );
  }

  const groundError = fieldErrors.ground?.[0];
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex gap-3 rounded-[var(--radius)] bg-warning-soft p-3 text-sm text-ink">
        <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
        <p>{NOT_A_GROUND}</p>
      </div>

      <fieldset aria-describedby={groundError ? `${groundName}-error` : undefined}>
        <legend className="mb-2 text-sm font-semibold text-ink">What went wrong?</legend>
        <div className="flex flex-col gap-2">
          {APPEAL_GROUNDS.map((g) => {
            const id = `${groundName}-${g.value}`;
            const selected = ground === g.value;
            return (
              <label
                key={g.value}
                htmlFor={id}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-[var(--radius)] border p-3 transition-colors",
                  selected ? "border-ink bg-surface-2" : "border-line-strong bg-surface hover:bg-surface-2",
                )}
              >
                <input
                  id={id}
                  type="radio"
                  name={groundName}
                  value={g.value}
                  checked={selected}
                  onChange={() => setGround(g.value)}
                  className="mt-1 size-4 shrink-0 accent-[var(--ink)]"
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{g.label}</span>
                  <span className="block text-sm text-ink-2">{g.description}</span>
                  <span className="mt-0.5 block text-xs text-ink-3">e.g. {g.example}</span>
                </span>
              </label>
            );
          })}
        </div>
        {groundError ? (
          <p id={`${groundName}-error`} role="alert" className="mt-1.5 text-sm font-medium text-danger">
            {groundError}
          </p>
        ) : null}
      </fieldset>

      <Textarea
        label="Explain the mistake"
        hint="Point to the exact part of the verdict, and the part of your submission it got wrong. The reviewer reads both."
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={APPEAL_TEXT_MAX}
        minLength={APPEAL_TEXT_MIN}
        showCount
        rows={5}
        required
        error={fieldErrors.text}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={understoodId} className="flex cursor-pointer items-start gap-3 text-sm text-ink">
          <input
            id={understoodId}
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]"
          />
          <span>
            I understand this is my only appeal for this debate. A reviewer who wasn&rsquo;t in the debate will either
            keep the verdict, order one fresh AI evaluation, or change the result with a written reason.
          </span>
        </label>
        {fieldErrors.understood ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {fieldErrors.understood[0]}
          </p>
        ) : null}
      </div>

      {formError ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Send appeal
        </Button>
      </div>
    </form>
  );
}
