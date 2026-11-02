"use client";

import Link from "@/shims/next-link";
import { useRouter } from "@/shims/next-navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { LogOut, Settings, Shield, User } from "lucide-react";
import { Avatar } from "@/components/argue/ui/avatar";
import { useToast } from "@/components/argue/ui/toast";
import { signOut } from "@domain/lib/server-actions";

export interface ProfileMenuProps {
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  isStaff: boolean;
}

export function ProfileMenu({ displayName, handle, avatarUrl, isStaff }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { error } = useToast();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleSignOut() {
    startTransition(async () => {
      const result = await signOut();
      if (!result.ok) {
        error(result.error);
        return;
      }
      setOpen(false);
      router.push("/");
      router.refresh();
    });
  }

  const itemClass = "flex h-11 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-ink hover:bg-surface-2";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-10 items-center justify-center rounded-full"
      >
        <Avatar name={displayName} src={avatarUrl} size="sm" />
        <span className="sr-only">Open profile menu</span>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute top-12 right-0 z-50 w-60 rounded-[var(--radius)] border border-line bg-surface p-1.5"
        >
          <div className="border-b border-line px-3 pt-1.5 pb-2.5">
            <p className="truncate font-semibold text-ink">{displayName}</p>
            {handle ? <p className="truncate text-sm text-ink-3">@{handle}</p> : null}
          </div>
          <div className="pt-1.5">
            {handle ? (
              <Link role="menuitem" href={`/u/${handle}`} className={itemClass} onClick={() => setOpen(false)}>
                <User aria-hidden className="size-4" /> Your profile
              </Link>
            ) : null}
            <Link role="menuitem" href="/settings" className={itemClass} onClick={() => setOpen(false)}>
              <Settings aria-hidden className="size-4" /> Settings
            </Link>
            {isStaff ? (
              <Link role="menuitem" href="/admin" className={itemClass} onClick={() => setOpen(false)}>
                <Shield aria-hidden className="size-4" /> Admin
              </Link>
            ) : null}
            <button role="menuitem" type="button" className={itemClass} onClick={handleSignOut} disabled={pending}>
              <LogOut aria-hidden className="size-4" /> {pending ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
