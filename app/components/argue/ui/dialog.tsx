"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@domain/lib/cn";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Action buttons, right-aligned (stacked on mobile). */
  footer?: ReactNode;
  className?: string;
}

/**
 * Modal dialog on the native <dialog> element: focus trapping, Esc-to-close and inert background come
 * from the browser. On phones it docks to the bottom like a sheet.
 */
export function Dialog({ open, onClose, title, description, children, footer, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Click on the backdrop (the dialog element itself, outside the panel) closes it.
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "m-0 mt-auto w-full max-w-none rounded-t-[var(--radius-lg)] border border-line bg-surface p-0 text-ink",
        "backdrop:bg-[rgb(8_13_31/0.55)] sm:m-auto sm:max-w-lg sm:rounded-[var(--radius-lg)]",
        className,
      )}
    >
      <div className="flex max-h-[85dvh] flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="text-2xl">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-sm text-ink-2">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2"
          >
            <X aria-hidden className="size-5" />
            <span className="sr-only">Close</span>
          </button>
        </div>
        {children ? <div className="overflow-y-auto px-5 py-4">{children}</div> : null}
        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>
        ) : null}
      </div>
    </dialog>
  );
}
