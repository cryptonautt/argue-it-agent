"use client";

import { useRouter } from "@/shims/next-navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Avatar } from "@/components/argue/ui/avatar";
import { Button } from "@/components/argue/ui/button";
import { Input } from "@/components/argue/ui/input";
import { Textarea } from "@/components/argue/ui/textarea";
import { useToast } from "@/components/argue/ui/toast";
import type { FieldErrors } from "@domain/lib/action-result";
import { updateProfile } from "@/lib/server-actions";
import { BIO_MAX } from "@domain/profiles/schemas";

export interface ProfileFormProps {
  handle: string;
  initial: { displayName: string; bio: string | null; avatarUrl: string | null };
}

/** Settings → Profile: display name, bio and avatar URL. */
export function ProfileForm({ handle, initial }: ProfileFormProps) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl ?? "");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const { success, error } = useToast();
  const router = useRouter();

  const previewSrc = avatarUrl.trim().startsWith("https://") ? avatarUrl.trim() : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateProfile({ displayName, bio, avatarUrl });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        error(result.error);
        return;
      }
      setFieldErrors({});
      setDisplayName(result.data.displayName);
      setBio(result.data.bio ?? "");
      setAvatarUrl(result.data.avatarUrl ?? "");
      success("Profile saved");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="flex items-center gap-3">
        <Avatar name={displayName || handle} src={previewSrc} size="lg" />
        <div className="text-sm">
          <p className="font-semibold text-ink">{displayName || "Your name"}</p>
          <p className="text-ink-3">@{handle} · handles can&apos;t be changed yet</p>
        </div>
      </div>
      <Input
        label="Display name"
        name="displayName"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={50}
        autoComplete="nickname"
        required
        error={fieldErrors.displayName}
      />
      <Textarea
        label="Bio"
        name="bio"
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        maxLength={BIO_MAX}
        showCount
        rows={3}
        hint="A line about you and what you argue about."
        error={fieldErrors.bio}
      />
      <Input
        label="Avatar image link"
        name="avatarUrl"
        type="url"
        inputMode="url"
        value={avatarUrl}
        onChange={(e) => setAvatarUrl(e.target.value)}
        placeholder="https://…"
        hint="Optional. A link to an image that starts with https://. Leave empty to use your initials."
        error={fieldErrors.avatarUrl}
      />
      <Button type="submit" loading={pending}>
        Save profile
      </Button>
    </form>
  );
}
