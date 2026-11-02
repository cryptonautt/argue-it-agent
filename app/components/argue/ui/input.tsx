import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@domain/lib/cn";
import { Field, controlClasses, fieldDescribedBy } from "./field";

export interface InputProps extends Omit<ComponentProps<"input">, "id"> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | string[];
  id?: string;
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean;
}

export function Input({ label, hint, error, id, hideLabel, className, required, ...props }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field
      id={inputId}
      label={hideLabel ? <span className="sr-only">{label}</span> : label}
      hint={hint}
      error={error}
      required={required}
    >
      <input
        id={inputId}
        className={cn(controlClasses, "h-11", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescribedBy(inputId, hint, error)}
        required={required}
        {...props}
      />
    </Field>
  );
}
