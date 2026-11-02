"use client";

import { useId, useState, type ChangeEvent, type ComponentProps, type ReactNode } from "react";
import { cn } from "@domain/lib/cn";
import { Field, controlClasses, fieldDescribedBy } from "./field";

export interface TextareaProps extends Omit<ComponentProps<"textarea">, "id"> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | string[];
  id?: string;
  /** Show "123 / 2,000" next to the label (requires maxLength). */
  showCount?: boolean;
}

const nf = new Intl.NumberFormat("en-GB");

/** Multi-line input. With `maxLength` + `showCount`, shows a live character counter. */
export function Textarea({
  label,
  hint,
  error,
  id,
  showCount = false,
  maxLength,
  className,
  rows = 5,
  required,
  onChange,
  value,
  defaultValue,
  ...props
}: TextareaProps) {
  const autoId = useId();
  const textareaId = id ?? autoId;
  const [uncontrolledLength, setUncontrolledLength] = useState(() => String(defaultValue ?? "").length);
  const length = value !== undefined ? String(value).length : uncontrolledLength;
  const nearLimit = maxLength !== undefined && length > maxLength * 0.9;

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    if (value === undefined) setUncontrolledLength(event.target.value.length);
    onChange?.(event);
  }

  return (
    <Field
      id={textareaId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      aside={
        showCount && maxLength !== undefined ? (
          <span className={cn("tabular text-xs", nearLimit ? "font-semibold text-warning" : "text-ink-3")}>
            {nf.format(length)} / {nf.format(maxLength)}
          </span>
        ) : null
      }
    >
      <textarea
        id={textareaId}
        rows={rows}
        maxLength={maxLength}
        className={cn(controlClasses, "min-h-24 resize-y py-2.5 leading-relaxed", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescribedBy(textareaId, hint, error)}
        required={required}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        {...props}
      />
    </Field>
  );
}
