"use client";

import { useTransition } from "react";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/argue/ui/button";
import { useToast } from "@/components/argue/ui/toast";
import { markAllNotificationsRead } from "@/lib/server-actions";

export function MarkAllReadButton() {
  const [pending, startTransition] = useTransition();
  const { success, error } = useToast();

  return (
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      icon={<CheckCheck aria-hidden className="size-4" />}
      onClick={() =>
        startTransition(async () => {
          const result = await markAllNotificationsRead();
          if (!result.ok) {
            error(result.error);
            return;
          }
          success(result.data.marked === 1 ? "1 notification marked read" : `${result.data.marked} notifications marked read`);
        })
      }
    >
      Mark all read
    </Button>
  );
}
