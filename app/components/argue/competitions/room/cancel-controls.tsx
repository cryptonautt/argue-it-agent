"use client";
// Owner: challenges. Mutual cancellation for participants (design §4.2: active challenges are cancelled
// only when both sides ask) and the admin cancel (reason required, audited).

import { useState } from "react";
import { Button } from "@/components/argue/ui/button";
import { Dialog } from "@/components/argue/ui/dialog";
import { Textarea } from "@/components/argue/ui/textarea";
import { requestCancel, retractCancel } from "@domain/lib/server-actions";
import { CANCEL_REASON_MAX_CHARS } from "@domain/competitions/terms";
import { useCompetitionAction } from "../use-competition-action";

export function MutualCancelControls({
  competitionId,
  youRequested,
  opponentRequested,
  opponentHandle,
}: {
  competitionId: string;
  youRequested: boolean;
  opponentRequested: boolean;
  opponentHandle: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const request = useCompetitionAction(requestCancel, {
    success: opponentRequested ? "Challenge cancelled" : "Cancel request sent",
    onSuccess: () => setOpen(false),
  });
  const retract = useCompetitionAction(retractCancel, { success: "Cancel request withdrawn" });

  if (youRequested) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-[var(--radius)] bg-surface-2 p-4 text-sm sm:flex-row sm:items-center">
        <p className="text-ink-2 sm:mr-auto">You asked to cancel. It’s cancelled only if @{opponentHandle} agrees.</p>
        <Button variant="ghost" size="sm" loading={retract.pending} onClick={() => retract.run({ competitionId })}>
          Take it back
        </Button>
      </div>
    );
  }

  return (
    <>
      {opponentRequested ? (
        <div role="status" className="flex flex-col gap-2 rounded-[var(--radius)] bg-warning-soft p-4 text-sm sm:flex-row sm:items-center">
          <p className="text-warning sm:mr-auto">
            @{opponentHandle} asked to cancel. If you agree, the challenge ends with no verdict and no rating change.
          </p>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            Agree to cancel
          </Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Ask to cancel
          </Button>
        </div>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={opponentRequested ? "Agree to cancel?" : "Ask to cancel?"}
        description={
          opponentRequested
            ? "Both of you have now asked, so the challenge will be cancelled immediately. No verdict, no rating change."
            : `The challenge is cancelled only if @${opponentHandle} agrees. Until then, deadlines keep running.`
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep debating
            </Button>
            <Button variant="danger" loading={request.pending} onClick={() => request.run({ competitionId, reason: reason.trim() || null })}>
              {opponentRequested ? "Cancel challenge" : "Send request"}
            </Button>
          </>
        }
      >
        <Textarea
          label="Reason (optional)"
          hint="Shown to your opponent."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={CANCEL_REASON_MAX_CHARS}
          showCount
          rows={3}
          error={request.fieldErrors.reason}
        />
      </Dialog>
    </>
  );
}
