"use client";

// Owner: moderation. Admin-only role change (the server re-checks: admin, not self, not the last admin).
import { useRouter } from "@/shims/next-navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/argue/ui/button";
import { Select } from "@/components/argue/ui/select";
import { Textarea } from "@/components/argue/ui/textarea";
import { useToast } from "@/components/argue/ui/toast";
import type { FieldErrors } from "@domain/lib/action-result";
import type { UserRole } from "@domain/db/schema";
import { changeUserRole } from "@/lib/server-actions";
import { MODERATION_NOTE_MAX } from "@domain/moderation/policy";

const ROLE_OPTIONS = [
  { value: "user", label: "User" },
  { value: "moderator", label: "Moderator: reviews reports, hides content, suspends users" },
  { value: "admin", label: "Admin: everything, including roles and AI evaluation admin" },
] as const;

export function RoleForm({ userId, currentRole }: { userId: string; currentRole: UserRole }) {
  const [role, setRole] = useState<UserRole>(currentRole);
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { success, error } = useToast();

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await changeUserRole({ userId, role, note, idempotencyKey });
          if (!result.ok) {
            setFieldErrors(result.fieldErrors ?? {});
            error(result.error);
            return;
          }
          success(`Role changed to ${result.data.role}.`);
          setNote("");
          setIdempotencyKey(crypto.randomUUID());
          router.refresh();
        });
      }}
    >
      <Select label="Role" value={role} onChange={(event) => setRole(event.target.value as UserRole)} options={ROLE_OPTIONS} error={fieldErrors.role} />
      <Textarea
        label="Why? (goes in the audit log)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={MODERATION_NOTE_MAX}
        rows={2}
        required
        error={fieldErrors.note}
      />
      <Button type="submit" variant="secondary" loading={pending} disabled={role === currentRole}>
        Change role
      </Button>
    </form>
  );
}
