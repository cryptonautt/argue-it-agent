import { useId, type ComponentProps, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@domain/lib/cn";
import { Field, controlClasses, fieldDescribedBy } from "./field";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentProps<"select">, "id" | "children"> {
  label: ReactNode;
  options: readonly SelectOption[];
  /** Adds a first, empty option (e.g. "Choose a category"). */
  placeholder?: string;
  hint?: ReactNode;
  error?: string | string[];
  id?: string;
}

/** Native select (best on low-end phones: the OS picker). */
export function Select({ label, options, placeholder, hint, error, id, className, required, ...props }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <Field id={selectId} label={label} hint={hint} error={error} required={required}>
      <div className="relative">
        <select
          id={selectId}
          className={cn(controlClasses, "h-11 appearance-none pr-10", className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescribedBy(selectId, hint, error)}
          required={required}
          {...props}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-3" />
      </div>
    </Field>
  );
}
