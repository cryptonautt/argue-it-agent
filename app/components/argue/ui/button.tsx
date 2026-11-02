import Link from "@/shims/next-link";
import type { ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@domain/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "for" | "against" | "judge";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap select-none " +
  "rounded-[var(--radius)] transition-colors duration-150 " +
  "disabled:opacity-50 disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:pointer-events-none";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-ink-inverse hover:bg-ink-2",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-ink hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90 dark:text-ink-inverse",
  for: "bg-for text-on-for hover:bg-for-strong",
  against: "bg-against text-on-against hover:bg-against-strong",
  judge: "bg-judge text-on-judge hover:brightness-95",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-[0.95rem]", // 44px: comfortable tap target
  lg: "h-12 px-6 text-base",
};

export function buttonClasses(
  options: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string } = {},
): string {
  const { variant = "primary", size = "md", fullWidth = false, className } = options;
  return cn(base, variants[variant], sizes[size], fullWidth && "w-full", className);
}

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
  /** Icon rendered before the label. */
  icon?: ReactNode;
}

/** The one button. `type` defaults to "button" so it never submits a form by accident. */
export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, fullWidth, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  icon?: ReactNode;
}

/** A link styled as a button (navigation, not actions). */
export function ButtonLink({ variant, size, fullWidth, icon, className, children, ...props }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses({ variant, size, fullWidth, className })} {...props}>
      {icon}
      {children}
    </Link>
  );
}
