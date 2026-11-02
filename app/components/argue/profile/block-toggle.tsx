"use client";

import { useRouter } from "@/shims/next-navigation";
import { useState, useTransition } from "react";
import { Ban } from "lucide-react";
import { Button } from "@/components/argue/ui/button";
import { Dialog } from "@/components/argue/ui/dialog";
import { useToast } from "@/components/argue/ui/toast";
import { blockUser, unblockUser } from "@/lib/server-actions";

export interface BlockToggleProps {
  userId: string;
  handle: string;
  /** Whether the viewer currently blocks this user. */
  blocked: boolean;
}

/** Block / unblock from a profile, with a confirmation explaining what blocking does. */
export function BlockToggle({ userId, handle, blocked }: BlockToggleProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { success, error } = useToast();
  const router = useRouter();

  function run(action: "block" | "unblock") {
    startTransition(async () => {
      const result = action === "block" ? await blockUser({ userId }) : await unblockUser({ userId });
      if (!result.ok) {
        error(result.error);
        return;
      }
      setOpen(false);
      success(action === "block" ? `Blocked @${handle}` : `Unblocked @${handle}`);
      router.refresh();
    });
  }

  if (blocked) {
    return (
      <Button variant="secondary" size="sm" loading={pending} onClick={() => run("unblock")}>
        Unblock
      </Button>
    );
  }

  return (
    <>
      <Button variant="ghost" size="sm" icon={<Ban aria-hidden className="size-4" />} onClick={() => setOpen(true)}>
        Block
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Block @${handle}?`}
        description="You won't see each other's arguments or comments, and neither of you can challenge, follow or reply to the other. They won't be told."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Keep
            </Button>
            <Button variant="danger" loading={pending} onClick={() => run("block")}>
              Block
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">You can unblock any time from Settings.</p>
      </Dialog>
    </>
  );
}
