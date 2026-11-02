"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@domain/lib/cn";

export type ToastTone = "success" | "error" | "info";

export interface ToastOptions {
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss (default 4500; errors 7000). */
  duration?: number;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  toast: (message: string, options?: ToastOptions) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const icons = { success: CheckCircle2, error: AlertTriangle, info: Info } as const;
const tones: Record<ToastTone, string> = {
  success: "border-success",
  error: "border-danger",
  info: "border-line-strong",
};

/** Mount once (root layout). Renders a polite live region so screen readers announce toasts. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = nextId.current++;
      const tone = options.tone ?? "info";
      setItems((all) => [...all.slice(-2), { id, message, tone }]);
      window.setTimeout(() => dismiss(id), options.duration ?? (tone === "error" ? 7000 : 4500));
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (message) => toast(message, { tone: "success" }),
      error: (message) => toast(message, { tone: "error" }),
    }),
    [toast],
  );

  return (
    <ToastContext value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottom-nav-h)+12px)] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {items.map((item) => {
          const Icon = icons[item.tone];
          return (
            <div
              key={item.id}
              role={item.tone === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-[var(--radius)] border-l-4 bg-ink px-4 py-3 text-sm text-ink-inverse",
                "animate-[toast-in_200ms_var(--ease-out)]",
                tones[item.tone],
              )}
            >
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <p className="flex-1">{item.message}</p>
              <button type="button" onClick={() => dismiss(item.id)} className="-m-1 rounded p-1 opacity-80 hover:opacity-100">
                <X aria-hidden className="size-4" />
                <span className="sr-only">Dismiss</span>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext>
  );
}

/** `const { success, error, toast } = useToast();` — must be under <ToastProvider>. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
