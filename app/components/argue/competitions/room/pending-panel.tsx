"use client";
// Owner: challenges. What each person can do while a challenge waits for a reply.

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/argue/ui/button";
import { Card } from "@/components/argue/ui/card";
import { Dialog } from "@/components/argue/ui/dialog";
import { Textarea } from "@/components/argue/ui/textarea";
import { acceptChallenge, declineChallenge, withdrawChallenge } from "@domain/lib/server-actions";
import { DECLINE_REASON_MAX_CHARS } from "@domain/competitions/terms";
import { useCompetitionAction } from "../use-competition-action";

export function RecipientDecision({
  competitionId,
  termsHash,
  challengerHandle,
  yourSide,
  disabledReason,
}: {
  competitionId: string;
  termsHash: string;
  challengerHandle: string;
  yourSide: "FOR" | "AGAINST";
  disabledReason: string | null;
}) {
  const [read, setRead] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");
  const accept = useCompetitionAction(acceptChallenge, { success: "Challenge accepted. Round 1 has started." });
  const decline = useCompetitionAction(declineChallenge, {
    success: "Challenge declined",
    onSuccess: () => setDeclineOpen(false),
  });

  return (
    <Card className="border-2 border-ink">
      <h2 className="text-2xl text-ink">@{challengerHandle} challenged you</h2>
      <p className="mt-1 text-sm text-ink-2">
        You’d argue <strong>{yourSide}</strong> the proposition. Read the full terms and rubric above before you decide —
        once you accept they can’t change, and the opening round starts straight away.
      </p>
      <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
        <input
          type="checkbox"
          checked={read}
          onChange={(event) => setRead(event.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-[var(--ink)]"
        />
        <span>I’ve read the terms, the rubric and the no-show rule, and I agree to them.</span>
      </label>
      {disabledReason ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {disabledReason}
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button
          variant={yourSide === "FOR" ? "for" : "against"}
          size="lg"
          fullWidth
          disabled={!read || disabledReason !== null}
          loading={accept.pending}
          icon={<Check aria-hidden className="size-4" />}
          onClick={() => accept.run({ competitionId, termsHash })}
        >
          Accept and argue {yourSide}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          disabled={disabledReason !== null}
          icon={<X aria-hidden className="size-4" />}
          onClick={() => setDeclineOpen(true)}
        >
          Decline
        </Button>
      </div>
      <Dialog
        open={declineOpen}
        onClose={() => setDeclineOpen(false)}
        title="Decline this challenge?"
        description={`@${challengerHandle} will be told you declined. Nothing else happens.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeclineOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={decline.pending}
              onClick={() => decline.run({ competitionId, reason: reason.trim() || null })}
            >
              Decline challenge
            </Button>
          </>
        }
      >
        <Textarea
          label="Reason (optional)"
          hint="Shown to the challenger."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={DECLINE_REASON_MAX_CHARS}
          showCount
          rows={3}
          error={decline.fieldErrors.reason}
        />
      </Dialog>
    </Card>
  );
}

export function ChallengerWaiting({ competitionId, recipientHandle }: { competitionId: string; recipientHandle: string }) {
  const [open, setOpen] = useState(false);
  const withdraw = useCompetitionAction(withdrawChallenge, {
    success: "Challenge withdrawn",
    onSuccess: () => setOpen(false),
  });
  return (
    <Card>
      <h2 className="text-2xl text-ink">Waiting for @{recipientHandle}</h2>
      <p className="mt-1 text-sm text-ink-2">
        They can accept or decline until the deadline above. We’ll notify you either way. You can withdraw until they accept.
      </p>
      <div className="mt-3">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Withdraw challenge
        </Button>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Withdraw this challenge?"
        description={`@${recipientHandle} won’t be able to accept it any more.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button variant="danger" loading={withdraw.pending} onClick={() => withdraw.run({ competitionId })}>
              Withdraw
            </Button>
          </>
        }
      />
    </Card>
  );
}
