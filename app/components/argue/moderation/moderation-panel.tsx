"use client";

// Owner: moderation. Staff action panel: pick an action → confirm with a reason code (+ note/duration) → done.
// The server re-checks every permission; this UI only offers what the server said is allowed.
import { useRouter } from "@/shims/next-navigation";
import { useState, useTransition } from "react";
import { Ban, EyeOff, MessageSquareWarning, RotateCcw, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { Button, type ButtonVariant } from "@/components/argue/ui/button";
import { Select } from "@/components/argue/ui/select";
import { Textarea } from "@/components/argue/ui/textarea";
import { useToast } from "@/components/argue/ui/toast";
import type { ActionResult, FieldErrors } from "@domain/lib/action-result";
import type { ReportReason, ReportTarget } from "@domain/db/schema";
import { dismissReport, moderateContent, suspendUser, unsuspendUser, warnUser } from "@/lib/server-actions";
import {
  MODERATION_NOTE_MAX,
  MODERATION_REASON_CODES,
  REASON_INFO,
  SUSPENSION_DURATIONS,
  TARGET_LABEL,
  type PanelAction,
  type SuspensionDurationKey,
} from "@domain/moderation/policy";

export type { PanelAction } from "@domain/moderation/policy";

export interface ModerationPanelProps {
  /** Actions the server says this staff member may take right now. */
  actions: PanelAction[];
  target?: { type: ReportTarget; id: string };
  user: { id: string; handle: string | null };
  reportId?: string;
  defaultReason?: ReportReason;
  canSuspendIndefinitely: boolean;
  /** Why some actions are missing (e.g. "Only an admin can moderate a staff member."). */
  restrictionNote?: string | null;
}

const META: Record<PanelAction, { label: string; icon: typeof EyeOff; variant: ButtonVariant; confirm: string }> = {
  hide: { label: "Hide", icon: EyeOff, variant: "secondary", confirm: "Hide it" },
  remove: { label: "Remove", icon: Trash2, variant: "danger", confirm: "Remove it" },
  restore: { label: "Restore", icon: RotateCcw, variant: "secondary", confirm: "Restore it" },
  warn: { label: "Warn author", icon: MessageSquareWarning, variant: "secondary", confirm: "Send warning" },
  suspend: { label: "Suspend author", icon: Ban, variant: "danger", confirm: "Suspend account" },
  unsuspend: { label: "Lift suspension", icon: ShieldCheck, variant: "secondary", confirm: "Lift suspension" },
  dismiss: { label: "Dismiss report", icon: XCircle, variant: "ghost", confirm: "Dismiss" },
};

function explain(action: PanelAction, target: ModerationPanelProps["target"], handle: string): string {
  const what = target ? `this ${TARGET_LABEL[target.type]}` : "their content";
  switch (action) {
    case "hide":
      return `Hides ${what} from everyone except staff. Reversible. Open reports on it are closed as actioned.`;
    case "remove":
      return target?.type === "profile"
        ? `Clears @${handle}'s bio and photo. Their handle and name stay.`
        : `Removes ${what}. Replies and debates on it stay, with a "removed" placeholder. Reversible by staff.`;
    case "restore":
      return `Makes ${what} visible again.`;
    case "warn":
      return `Sends @${handle} a private warning. Nothing is hidden.`;
    case "suspend":
      return `@${handle} can still read but can't post, comment, react, challenge or submit. In active debates a missed opening counts as a no-show (forfeit) under the debate rules. Verdicts and ratings are never changed by moderation.`;
    case "unsuspend":
      return `@${handle} can post again immediately.`;
    case "dismiss":
      return "Closes this report with no action. The content stays as it is.";
  }
}

export function ModerationPanel({ actions, target, user, reportId, defaultReason, canSuspendIndefinitely, restrictionNote }: ModerationPanelProps) {
  const [selected, setSelected] = useState<PanelAction | null>(null);
  const [reason, setReason] = useState<ReportReason>(defaultReason ?? "spam");
  const [duration, setDuration] = useState<SuspensionDurationKey>("24h");
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { success, error } = useToast();
  const handle = user.handle ?? "user";

  if (actions.length === 0) {
    return <p className="text-sm text-ink-2">{restrictionNote ?? "No actions available."}</p>;
  }

  function choose(action: PanelAction) {
    setSelected(action);
    setFieldErrors({});
    setStatus("");
  }

  function run(action: PanelAction): Promise<ActionResult<unknown>> {
    const noteOrUndefined = note.trim() ? note : undefined;
    switch (action) {
      case "hide":
      case "remove":
      case "restore":
        if (!target) throw new Error("content action without a target");
        return moderateContent({ targetType: target.type, targetId: target.id, action, reasonCode: reason, note: noteOrUndefined, reportId, idempotencyKey });
      case "warn":
        return warnUser({ userId: user.id, reasonCode: reason, note: noteOrUndefined, reportId, idempotencyKey });
      case "suspend":
        return suspendUser({ userId: user.id, duration, reasonCode: reason, note, reportId, idempotencyKey });
      case "unsuspend":
        return unsuspendUser({ userId: user.id, note, idempotencyKey });
      case "dismiss":
        if (!reportId) throw new Error("dismiss without a report");
        return dismissReport({ reportId, note: noteOrUndefined, idempotencyKey });
    }
  }

  function confirm() {
    if (!selected) return;
    const action = selected;
    startTransition(async () => {
      const result = await run(action);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setStatus(result.error);
        error(result.error);
        return;
      }
      const done = `${META[action].label}: done.`;
      setStatus(done);
      success(done);
      setSelected(null);
      setNote("");
      setIdempotencyKey(crypto.randomUUID());
      router.refresh();
    });
  }

  const needsReason = selected !== null && selected !== "unsuspend" && selected !== "dismiss" && selected !== "restore";
  const noteRequired = selected === "suspend" || selected === "unsuspend";
  const durationOptions = SUSPENSION_DURATIONS.map((d) => ({
    value: d.key,
    label: d.label,
    disabled: d.hours === null && !canSuspendIndefinitely,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Moderation actions">
        {actions.map((action) => {
          const { label, icon: Icon, variant } = META[action];
          return (
            <Button
              key={action}
              variant={selected === action ? "primary" : variant === "danger" ? "secondary" : variant}
              size="sm"
              icon={<Icon aria-hidden className="size-4" />}
              aria-pressed={selected === action}
              onClick={() => choose(action)}
            >
              {label}
            </Button>
          );
        })}
      </div>
      {restrictionNote ? <p className="text-xs text-ink-3">{restrictionNote}</p> : null}

      {selected ? (
        <form
          className="space-y-3 rounded-[var(--radius)] border border-line-strong bg-surface p-4"
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
          aria-label={`Confirm: ${META[selected].label}`}
        >
          <p className="text-sm text-ink-2">{explain(selected, target, handle)}</p>
          {needsReason ? (
            <Select
              label="Reason code"
              value={reason}
              onChange={(event) => setReason(event.target.value as ReportReason)}
              options={MODERATION_REASON_CODES.map((code) => ({ value: code, label: REASON_INFO[code].label }))}
              error={fieldErrors.reasonCode}
            />
          ) : null}
          {selected === "suspend" ? (
            <Select
              label="Duration"
              value={duration}
              onChange={(event) => setDuration(event.target.value as SuspensionDurationKey)}
              options={durationOptions}
              hint={canSuspendIndefinitely ? undefined : "Indefinite suspensions need an admin."}
              error={fieldErrors.duration}
            />
          ) : null}
          <Textarea
            label={noteRequired ? "Reason (goes in the audit log)" : "Note (optional, staff only)"}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={MODERATION_NOTE_MAX}
            rows={2}
            required={noteRequired}
            error={fieldErrors.note}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setSelected(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant={META[selected].variant === "danger" ? "danger" : "primary"} loading={pending}>
              {META[selected].confirm}
            </Button>
          </div>
        </form>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  );
}
