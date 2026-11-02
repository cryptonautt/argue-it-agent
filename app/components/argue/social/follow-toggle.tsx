"use client";

import { useOptimistic, useState, useTransition } from "react";
import { UserCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/argue/ui/button";
import { useToast } from "@/components/argue/ui/toast";
import { followUser, unfollowUser } from "@/lib/server-actions";
import type { FollowState } from "@domain/social/types";

export interface FollowToggleProps {
  initial: FollowState;
  /** Shown in the screen-reader label, e.g. "@ada". */
  name: string;
}

export function FollowToggle({ initial, name }: FollowToggleProps) {
  const [state, setState] = useState(initial);
  const [optimistic, setOptimistic] = useOptimistic(state);
  const [, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const { error } = useToast();

  function toggle() {
    const next = !optimistic.following;
    startTransition(async () => {
      setOptimistic({
        ...optimistic,
        following: next,
        followerCount: Math.max(0, optimistic.followerCount + (next ? 1 : -1)),
      });
      const result = next ? await followUser({ userId: state.userId }) : await unfollowUser({ userId: state.userId });
      if (!result.ok) {
        error(result.error);
        return;
      }
      setState(result.data);
      setAnnouncement(result.data.following ? `You're following ${name}.` : `You unfollowed ${name}.`);
    });
  }

  return (
    <>
      <Button
        variant={optimistic.following ? "secondary" : "primary"}
        size="sm"
        aria-pressed={optimistic.following}
        onClick={toggle}
        icon={optimistic.following ? <UserCheck aria-hidden className="size-4" /> : <UserPlus aria-hidden className="size-4" />}
      >
        {optimistic.following ? "Following" : "Follow"}
        <span className="sr-only"> {name}</span>
      </Button>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
