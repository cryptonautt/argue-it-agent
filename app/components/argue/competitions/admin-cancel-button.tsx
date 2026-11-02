"use client";
// Owner: challenges. Admin-only cancellation with a required reason (audited; both participants are
// notified). Usable from the competition room and the admin competitions monitor.

import { useState } from "react";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/argue/ui/button";
import { Dialog } from "@/components/argue/ui/dialog";
import { Textarea } from "@/components/argue/ui/textarea";
import { adminCancelCompetition } from "@domain/lib/server-actions";
import { CANCEL_REASON_MAX_CHARS } from "@domain/competitions/terms";
import { useCompetitionAction } from "./use-competition-action";

export interface AdminCancelButtonProps {
  competitionId: string;
}

export function AdminCancelButton({ competitionId }: AdminCancelButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const cancel = useCompetitionAction(adminCancelCompetition, {
    success: "Competition cancelled",
    onSuccess: () => setOpen(false),
  });
  return (
    <>
      <Button variant="danger" size="sm" icon={<ShieldX aria-hidden className="size-4" />} onClick={() => setOpen(true)}>
        Admin cancel
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Cancel this competition?"
        description="Both participants are notified and see your reason. No rating change. This is recorded in the audit log."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button
              variant="danger"
              loading={cancel.pending}
              disabled={reason.trim().length < 5}
              onClick={() => cancel.run({ competitionId, reason })}
            >
              Cancel competition
            </Button>
          </>
        }
      >
        <Textarea
          label="Reason"
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={CANCEL_REASON_MAX_CHARS}
          showCount
          rows={3}
          error={cancel.fieldErrors.reason}
        />
      </Dialog>
    </>
  );
}
