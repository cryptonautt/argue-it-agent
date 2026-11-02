import { CalendarDays, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/argue/ui/avatar";
import { ButtonLink } from "@/components/argue/ui/button";
import type { PublicProfile } from "@domain/profiles/queries";
import { formatJoined } from "./format";

export interface ProfileHeaderProps {
  profile: PublicProfile;
  isOwnProfile: boolean;
  /** Follow / block / report controls for other viewers. */
  actions?: ReactNode;
}

export function ProfileHeader({ profile, isOwnProfile, actions }: ProfileHeaderProps) {
  return (
    <header className="mb-6">
      <div className="flex items-start gap-4">
        <Avatar name={profile.displayName} src={profile.avatarUrl} size="xl" />
        <div className="min-w-0 flex-1">
          <h1 className="text-4xl leading-tight break-words text-ink sm:text-5xl">{profile.displayName}</h1>
          <p className="text-ink-3">@{profile.handle}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
            <CalendarDays aria-hidden className="size-3.5" />
            Joined {formatJoined(profile.joinedAt)}
          </p>
        </div>
      </div>
      {profile.bio ? <p className="mt-4 max-w-prose whitespace-pre-line break-words text-ink-2">{profile.bio}</p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isOwnProfile ? (
          <ButtonLink href="/settings" variant="secondary" size="sm" icon={<Pencil aria-hidden className="size-4" />}>
            Edit profile
          </ButtonLink>
        ) : (
          actions
        )}
      </div>
    </header>
  );
}
