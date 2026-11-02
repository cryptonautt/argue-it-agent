"use client";

import { useRouter } from "@/shims/next-navigation";
import { useCallback, useState, useTransition } from "react";
import { useToast } from "@/components/argue/ui/toast";
import type { ActionResult, FieldErrors } from "@domain/lib/action-result";

/**
 * Run a competition server action with a double-submit-safe idempotency key (design §5.4): the same key
 * is reused if the user taps twice or retries after a network blip, and a fresh one is generated only
 * after a success. Refreshes the route so server-rendered state (deadlines, sealing) updates.
 */
export function useCompetitionAction<I extends { idempotencyKey: string }, T>(
  action: (input: I) => Promise<ActionResult<T>>,
  options: { success?: string | ((data: T) => string); onSuccess?: (data: T) => void } = {},
) {
  const router = useRouter();
  const { success, error } = useToast();
  const [pending, startTransition] = useTransition();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [lastError, setLastError] = useState<string | null>(null);
  const { success: successMessage, onSuccess } = options;

  const run = useCallback(
    (input: Omit<I, "idempotencyKey">) => {
      startTransition(async () => {
        const result = await action({ ...input, idempotencyKey: key } as I);
        if (!result.ok) {
          setFieldErrors(result.fieldErrors ?? {});
          setLastError(result.error);
          error(result.error);
          router.refresh();
          return;
        }
        setFieldErrors({});
        setLastError(null);
        setKey(crypto.randomUUID());
        if (successMessage) success(typeof successMessage === "function" ? successMessage(result.data) : successMessage);
        onSuccess?.(result.data);
        router.refresh();
      });
    },
    [action, key, error, success, successMessage, onSuccess, router],
  );

  return { run, pending, fieldErrors, lastError };
}
