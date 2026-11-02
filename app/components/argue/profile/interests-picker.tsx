"use client";

import { useRouter } from "@/shims/next-navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/argue/ui/button";
import { useToast } from "@/components/argue/ui/toast";
import { cn } from "@domain/lib/cn";
import { saveInterests } from "@/lib/server-actions";
import { MAX_INTERESTS } from "@domain/profiles/schemas";

export interface InterestOption {
  slug: string;
  name: string;
  description: string;
}

export interface InterestsPickerProps {
  categories: readonly InterestOption[];
  initial: readonly string[];
  /** "onboarding": Continue/Skip and go to the feed. "settings": Save in place. */
  mode: "onboarding" | "settings";
  /** Where onboarding goes afterwards (default "/"). */
  nextHref?: string;
}

/** Pick favourite categories. Used by /welcome and Settings. */
export function InterestsPicker({ categories, initial, mode, nextHref = "/" }: InterestsPickerProps) {
  const [selected, setSelected] = useState<string[]>(() => [...initial]);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState("");
  const { success, error } = useToast();
  const router = useRouter();
  const atLimit = selected.length >= MAX_INTERESTS;

  function toggle(slug: string) {
    setStatus("");
    setSelected((current) => {
      if (current.includes(slug)) return current.filter((s) => s !== slug);
      if (current.length >= MAX_INTERESTS) return current;
      return [...current, slug];
    });
  }

  function submit(slugs: string[]) {
    startTransition(async () => {
      const result = await saveInterests({ categorySlugs: slugs, completeOnboarding: mode === "onboarding" });
      if (!result.ok) {
        error(result.error);
        return;
      }
      if (mode === "onboarding") {
        router.push(nextHref);
        router.refresh();
        return;
      }
      setStatus("Saved.");
      success("Favourite categories saved");
    });
  }

  return (
    <div>
      <fieldset>
        <legend className="mb-2 text-sm text-ink-2">
          Pick what you want to see more of (up to {MAX_INTERESTS}). This only shapes your feed — it never affects judging.
        </legend>
        <ul className="grid gap-2 sm:grid-cols-2">
          {categories.map((c) => {
            const on = selected.includes(c.slug);
            const disabled = !on && atLimit;
            return (
              <li key={c.slug}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => toggle(c.slug)}
                  className={cn(
                    "flex min-h-14 w-full items-start gap-3 rounded-[var(--radius)] border px-3 py-2.5 text-left transition-colors",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    on ? "border-ink bg-surface-2" : "border-line bg-surface hover:border-line-strong",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[4px] border",
                      on ? "border-ink bg-ink text-ink-inverse" : "border-line-strong",
                    )}
                  >
                    {on ? <Check className="size-3.5" /> : null}
                  </span>
                  <span>
                    <span className="block font-semibold text-ink">{c.name}</span>
                    {c.description ? <span className="block text-xs text-ink-3">{c.description}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {mode === "onboarding" ? (
          <>
            <Button size="lg" loading={pending} onClick={() => submit(selected)} disabled={selected.length === 0}>
              Continue to the feed
            </Button>
            <Button variant="ghost" onClick={() => submit([...initial])} disabled={pending}>
              Skip for now
            </Button>
          </>
        ) : (
          <Button loading={pending} onClick={() => submit(selected)}>
            Save categories
          </Button>
        )}
        <span role="status" aria-live="polite" className="text-sm text-ink-3">
          {status || `${selected.length} of ${MAX_INTERESTS} picked`}
        </span>
      </div>
    </div>
  );
}
