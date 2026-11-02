"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@domain/lib/cn";

export interface TabItem {
  key: string;
  label: ReactNode;
  content: ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  /** Initially selected key (defaults to the first tab). */
  defaultKey?: string;
  /** Controlled selection. */
  selectedKey?: string;
  onChange?: (key: string) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * In-page tabs with full WAI-ARIA tablist semantics (arrow keys, Home/End). For URL-driven tabs use
 * LinkTabs instead.
 */
export function Tabs({ items, defaultKey, selectedKey, onChange, ariaLabel, className }: TabsProps) {
  const baseId = useId();
  const [internalKey, setInternalKey] = useState(defaultKey ?? items[0]?.key ?? "");
  const activeKey = selectedKey ?? internalKey;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function select(key: string, focusIndex?: number) {
    if (selectedKey === undefined) setInternalKey(key);
    onChange?.(key);
    if (focusIndex !== undefined) tabRefs.current[focusIndex]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    const target =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (target === null) return;
    event.preventDefault();
    const item = items[target];
    if (item) select(item.key, target);
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label={ariaLabel} className="flex gap-1 overflow-x-auto border-b border-line">
        {items.map((item, index) => {
          const active = item.key === activeKey;
          return (
            <button
              key={item.key}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.key}`}
              aria-selected={active}
              aria-controls={`${baseId}-panel-${item.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => select(item.key)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={cn(
                "relative h-11 px-3 text-sm font-semibold whitespace-nowrap transition-colors",
                active ? "text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {item.label}
              {active ? <span aria-hidden className="slant absolute inset-x-2 -bottom-px h-[3px] bg-ink" /> : null}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.key}
          role="tabpanel"
          id={`${baseId}-panel-${item.key}`}
          aria-labelledby={`${baseId}-tab-${item.key}`}
          hidden={item.key !== activeKey}
          tabIndex={0}
          className="pt-4 focus-visible:outline-offset-4"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
