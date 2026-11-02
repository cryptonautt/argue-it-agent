import { cn } from "@domain/lib/cn";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const sizes: Record<AvatarSize, string> = {
  xs: "size-6 text-[0.65rem]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-lg",
  xl: "size-20 text-2xl",
};

// Neutral backgrounds only: blue/orange are reserved for FOR/AGAINST meaning.
const PALETTE = ["#3b4466", "#5a4a6b", "#2f5d62", "#6b5a3b", "#4f5b3a", "#5c3b4a", "#3a4f6b", "#5a5a5a"];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string): string {
  // Letters/digits only, so "Tolu (Admin)" → "TA" rather than "T(" and emoji don't split into halves.
  const parts = name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0] ?? "")[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1] ?? "")[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export interface AvatarProps {
  /** Display name (used for initials + alt text). */
  name: string;
  /** Optional image URL. Plain <img> (no optimisation proxy) keeps it light. */
  src?: string | null;
  size?: AvatarSize;
  className?: string;
}

export function Avatar({ name, src, size = "md", className }: AvatarProps) {
  const classes = cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold", sizes[size], className);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- user avatars from arbitrary hosts; keep it light
    return <img src={src} alt="" className={cn(classes, "bg-surface-2 object-cover")} loading="lazy" decoding="async" />;
  }
  return (
    <span aria-hidden className={cn(classes, "text-white")} style={{ backgroundColor: PALETTE[hash(name) % PALETTE.length] }}>
      {initials(name)}
    </span>
  );
}
