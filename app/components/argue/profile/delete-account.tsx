"use client";

import { useRouter } from "@/shims/next-navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/argue/ui/button";
import { Dialog } from "@/components/argue/ui/dialog";
import { Input } from "@/components/argue/ui/input";
import { useToast } from "@/components/argue/ui/toast";
import { deleteAccount } from "@/lib/server-actions";

export interface DeleteAccountProps {
  handle: string;
  /** Pending or live challenges that must finish first. */
  blockingChallenges: number;
}

/** Settings → Delete account: explains what is kept, then requires typing the handle. */
export function DeleteAccount({ handle, blockingChallenges }: DeleteAccountProps) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [fieldError, setFieldError] = useState<string[] | undefined>();
  const [pending, startTransition] = useTransition();
  const { error } = useToast();
  const router = useRouter();
  const formId = "delete-account-form";
  const matches = confirm.trim().replace(/^@/, "").toLowerCase() === handle;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await deleteAccount({ confirmHandle: confirm });
      if (!result.ok) {
        setFieldError(result.fieldErrors?.confirmHandle);
        error(result.error);
        return;
      }
      router.replace(result.data.redirectTo);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 text-sm text-ink-2">
      <p>Deleting your account:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>signs you out everywhere and removes your login, bio, avatar and follows;</li>
        <li>keeps your past arguments, comments and debates, shown as “Deleted user”, so your opponents&apos; records and verdicts stay accurate;</li>
        <li>can&apos;t be undone.</li>
      </ul>
      {blockingChallenges > 0 ? (
        <p className="rounded-[var(--radius-sm)] bg-warning-soft px-3 py-2 text-warning" role="note">
          You have {blockingChallenges === 1 ? "a challenge" : `${blockingChallenges} challenges`} pending or live. Finish,
          withdraw or cancel {blockingChallenges === 1 ? "it" : "them"} first — your opponent deserves a finished debate.
        </p>
      ) : null}
      <Button variant="danger" onClick={() => setOpen(true)} disabled={blockingChallenges > 0}>
        Delete my account
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title="Delete your account?"
        description={`This can't be undone. Type @${handle} to confirm.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="danger" loading={pending} disabled={!matches}>
              Delete forever
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={handleSubmit} noValidate>
          <Input
            label="Your handle"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setFieldError(undefined);
            }}
            placeholder={`@${handle}`}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            error={fieldError}
          />
        </form>
      </Dialog>
    </div>
  );
}
