"use client";

// Owner: moderation. Admin cancel for the competitions monitor. Delegates to the challenges team's
// adminCancelCompetition (state machine + audit + participant notifications live there).
import { useRouter } from "@/shims/next-navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/argue/ui/button";
import { Dialog } from "@/components/argue/ui/dialog";
import { Textarea } from "@/components/argue/ui/textarea";
import { useToast } from "@/components/argue/ui/toast";
import type { FieldErrors } from "@domain/lib/action-result";
import { adminCancelCompetition } from "@domain/lib/server-actions";

const REASON_MAX = 500;

export function CancelCompetitionButton({ competitionId, proposition }: { competitionId: string; proposition: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { success, error } = useToast();

  function submit() {
    startTransition(async () => {
      const result = await adminCancelCompetition({ competitionId, reason, idempotencyKey });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        error(result.error);
        return;
      }
      success("Debate cancelled. Both participants were notified.");
      setOpen(false);
      setReason("");
      setIdempotencyKey(crypto.randomUUID());
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Cancel debate
      </Button>
      {open ? (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title="Cancel this debate?"
          description={`“${proposition}”. No winner and no rating change. Both participants see your reason.`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Keep it
              </Button>
              <Button variant="danger" onClick={submit} loading={pending}>
                Cancel debate
              </Button>
            </>
          }
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Textarea
              label="Reason (shown to both participants, audited)"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={REASON_MAX}
              showCount
              rows={3}
              required
              error={fieldErrors.reason}
            />
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
