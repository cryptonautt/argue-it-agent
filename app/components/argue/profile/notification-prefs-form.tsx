"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/argue/ui/button";
import { useToast } from "@/components/argue/ui/toast";
import {
  MUTABLE_NOTIFICATION_LABELS,
  MUTABLE_NOTIFICATION_TYPES,
  type NotificationPrefsInput,
} from "@domain/lib/notification-prefs";
import { saveNotificationPrefs } from "@/lib/server-actions";

export interface NotificationPrefsFormProps {
  initial: NotificationPrefsInput;
}

/** Settings → Notifications: switch the social notification types on or off. */
export function NotificationPrefsForm({ initial }: NotificationPrefsFormProps) {
  const [prefs, setPrefs] = useState<NotificationPrefsInput>(initial);
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();
  const { success, error } = useToast();

  function save() {
    startTransition(async () => {
      const result = await saveNotificationPrefs(prefs);
      if (!result.ok) {
        error(result.error);
        return;
      }
      setStatus("Saved.");
      success("Notification settings saved");
    });
  }

  return (
    <div>
      <fieldset>
        <legend className="mb-3 text-sm text-ink-2">
          Choose which community notifications you get. Notifications about your debates (challenges, deadlines,
          verdicts, appeals) and about your account are always on, so you never miss a deadline or a decision.
        </legend>
        <ul className="space-y-2">
          {MUTABLE_NOTIFICATION_TYPES.map((type) => {
            const { label, hint } = MUTABLE_NOTIFICATION_LABELS[type];
            const id = `notif-${type}`;
            return (
              <li key={type}>
                <label
                  htmlFor={id}
                  className="flex min-h-12 cursor-pointer items-start gap-3 rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 hover:border-line-strong"
                >
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-[var(--color-ink)]"
                    checked={prefs[type]}
                    onChange={(e) => {
                      setStatus("");
                      setPrefs((p) => ({ ...p, [type]: e.target.checked }));
                    }}
                  />
                  <span>
                    <span className="block font-semibold text-ink">{label}</span>
                    <span className="block text-xs text-ink-3">{hint}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button loading={pending} onClick={save}>
          Save notification settings
        </Button>
        <span role="status" aria-live="polite" className="text-sm text-ink-3">
          {status}
        </span>
      </div>
      <p className="mt-3 text-xs text-ink-3">Email and push notifications aren&apos;t part of this version.</p>
    </div>
  );
}
