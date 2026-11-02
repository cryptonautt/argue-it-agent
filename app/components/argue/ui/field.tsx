import type { ReactNode } from "react";
import { cn } from "@domain/lib/cn";

export interface FieldProps {
  id: string;
  label: ReactNode;
  /** Help text under the control. */
  hint?: ReactNode;
  /** Error message(s); when present the control is marked aria-invalid by the caller. */
  error?: string | string[] | undefined;
  /** Rendered at the right of the label row (e.g. a character counter). */
  aside?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function fieldDescribedBy(id: string, hint: unknown, error: unknown): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function firstError(error: string | string[] | undefined): string | undefined {
  return Array.isArray(error) ? error[0] : error;
}

/** Label + control + hint + error, wired with ids for screen readers. Used by Input/Textarea/Select. */
export function Field({ id, label, hint, error, aside, required, className, children }: FieldProps) {
  const message = firstError(error);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
          {required ? (
            <span aria-hidden className="text-ink-3">
              {" "}
              *
            </span>
          ) : null}
        </label>
        {aside}
      </div>
      {children}
      {hint && !message ? (
        <p id={`${id}-hint`} className="text-sm text-ink-3">
          {hint}
        </p>
      ) : null}
      {message ? (
        <p id={`${id}-error`} className="text-sm font-medium text-danger" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export const controlClasses =
  "w-full rounded-[var(--radius-sm)] border border-line-strong bg-surface px-3 text-base text-ink " +
  "placeholder:text-ink-3 transition-colors focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-0 " +
  "aria-[invalid=true]:border-danger disabled:opacity-60";
