import Link from "@/shims/next-link";
import { cn } from "@domain/lib/cn";

/** Split-square mark: the two sides meeting at the slanted seam. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <path d="M2 4h17l-6 24H2z" fill="var(--for)" />
      <path d="M21 4h9v24H15z" fill="var(--against-bright)" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2 rounded-md", className)} aria-label="ARGUE IT home">
      <LogoMark />
      <span className="font-display text-2xl leading-none font-extrabold tracking-tight text-ink italic">ARGUE IT</span>
    </Link>
  );
}
