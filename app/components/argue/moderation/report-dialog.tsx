"use client";

// Owner: moderation. The report reason picker. Mounted only while open (fresh state each time).
import Link from "@/shims/next-link";
import { usePathname } from "@/shims/next-navigation";
import { useId, useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/argue/ui/button";
import { Dialog } from "@/components/argue/ui/dialog";
import { Textarea } from "@/components/argue/ui/textarea";
import { useToast } from "@/components/argue/ui/toast";
import { cn } from "@domain/lib/cn";
import type { FieldErrors } from "@domain/lib/action-result";
import type { ReportTarget } from "@domain/db/schema";
import { fileReport } from "@domain/lib/server-actions";
import { REASON_INFO, REPORT_DETAILS_MAX, TARGET_LABEL, USER_REPORT_REASONS, type UserReportReason } from "@domain/moderation/policy";

export interface ReportDialogProps {
  targetType: ReportTarget;
  targetId: string;
  onClose: () => void;
}

type Stage = { kind: "form" } | { kind: "done"; alreadyReported: boolean } | { kind: "signed-out" };

export function ReportDialog({ targetType, targetId, onClose }: ReportDialogProps) {
  const [reason, setReason] = useState<UserReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "form" });
  const [pending, startTransition] = useTransition();
  const { error: toastError } = useToast();
  const pathname = usePathname();
  const groupId = useId();
  const what = TARGET_LABEL[targetType];

  function submit() {
    if (!reason) {
      setFieldErrors({ reason: ["Pick the reason that fits best."] });
      return;
    }
    setFormError(null);
    startTransition(async () => {
      const result = await fileReport({ targetType, targetId, reason, details });
      if (result.ok) {
        setStage({ kind: "done", alreadyReported: result.data.alreadyReported });
        return;
      }
      if (result.code === "UNAUTHENTICATED") {
        setStage({ kind: "signed-out" });
        return;
      }
      setFieldErrors(result.fieldErrors ?? {});
      setFormError(result.error);
      if (!result.fieldErrors) toastError(result.error);
    });
  }

  if (stage.kind === "signed-out") {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Sign in to report"
        description="Reports come from signed-in members so moderators can follow up."
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Link
              href={`/sign-in?next=${encodeURIComponent(pathname)}`}
              className="inline-flex h-11 items-center justify-center rounded-[var(--radius)] bg-ink px-4 font-semibold text-ink-inverse"
            >
              Sign in
            </Link>
          </>
        }
      />
    );
  }

  if (stage.kind === "done") {
    return (
      <Dialog
        open
        onClose={onClose}
        title={stage.alreadyReported ? "Already reported" : "Thanks for reporting"}
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <div role="status" className="flex gap-3 text-ink-2">
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="space-y-2 text-sm">
            <p>
              {stage.alreadyReported
                ? `You've already reported this ${what}. A moderator will look at it.`
                : `A moderator will review this ${what} against the community rules.`}
            </p>
            <p>We never tell anyone who reported them. Moderation is separate from AI verdicts: a report never changes a debate result.</p>
            <p>
              If someone is in immediate danger, contact local emergency services first.{" "}
              <Link href="/rules" className="font-semibold text-ink underline underline-offset-2">
                Read the rules
              </Link>
            </p>
          </div>
        </div>
      </Dialog>
    );
  }

  const reasonError = fieldErrors.reason?.[0];
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Report this ${what}`}
      description="What's the problem? Your report is private."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={pending}>
            Send report
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="space-y-4"
        noValidate
      >
        <fieldset aria-describedby={reasonError ? `${groupId}-error` : undefined}>
          <legend className="sr-only">Reason</legend>
          <ul className="space-y-2">
            {USER_REPORT_REASONS.map((value) => {
              const info = REASON_INFO[value];
              const checked = reason === value;
              return (
                <li key={value}>
                  <label
                    className={cn(
                      "flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-sm)] border px-3 py-2.5 transition-colors",
                      checked ? "border-ink bg-surface-2" : "border-line hover:border-line-strong",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${groupId}-reason`}
                      value={value}
                      checked={checked}
                      onChange={() => {
                        setReason(value);
                        setFieldErrors((e) => ({ ...e, reason: undefined }));
                      }}
                      className="mt-1 size-4 accent-[var(--ink)]"
                    />
                    <span>
                      <span className="block font-semibold text-ink">{info.label}</span>
                      <span className="block text-sm text-ink-2">{info.description}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {reasonError ? (
            <p id={`${groupId}-error`} role="alert" className="mt-2 text-sm font-medium text-danger">
              {reasonError}
            </p>
          ) : null}
        </fieldset>

        <Textarea
          label={reason === "other" ? "What's wrong?" : "Anything else? (optional)"}
          hint="Moderators see this. Don't include your own private details."
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          maxLength={REPORT_DETAILS_MAX}
          showCount
          rows={3}
          required={reason === "other"}
          error={fieldErrors.details}
        />
        {formError && !fieldErrors.details && !reasonError ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {formError}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
