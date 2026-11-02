"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/shims/next-navigation";
import { Lock, PencilLine, Trash2 } from "lucide-react";
import { Button, ButtonLink } from "@/components/argue/ui/button";
import { Dialog } from "@/components/argue/ui/dialog";
import { useToast } from "@/components/argue/ui/toast";
import { deleteArgument } from "@domain/lib/server-actions";

export interface OwnerActionsProps {
  argumentId: string;
  /** Editing closed because a challenge was accepted. */
  locked: boolean;
  /** There are debates on this argument (shown in the delete warning). */
  hasDebates: boolean;
}

/** Author-only controls on the argument page: edit (until locked) and delete with confirmation. */
export function OwnerActions({ argumentId, locked, hasDebates }: OwnerActionsProps) {
  const router = useRouter();
  const { success, error } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    startTransition(async () => {
      const result = await deleteArgument({ argumentId });
      if (!result.ok) {
        error(result.error);
        return;
      }
      setConfirming(false);
      success("Argument deleted.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {locked ? (
        <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-sm text-ink-2">
          <Lock aria-hidden className="size-4" />
          Locked — a challenge was accepted
        </span>
      ) : (
        <ButtonLink href={`/a/${argumentId}/edit`} variant="secondary" size="sm" icon={<PencilLine aria-hidden className="size-4" />}>
          Edit
        </ButtonLink>
      )}
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} icon={<Trash2 aria-hidden className="size-4" />}>
        Delete
      </Button>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete this argument?"
        description="It disappears from feeds and search. This can't be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
              Keep it
            </Button>
            <Button variant="danger" onClick={confirmDelete} loading={pending}>
              Delete argument
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">
          Comments and positions stay attached under a &ldquo;deleted&rdquo; notice.
          {hasDebates ? " Debates already started from it carry on with their agreed terms." : ""}
        </p>
      </Dialog>
    </div>
  );
}
