"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "@/shims/next-navigation";
import { Eye, Lightbulb, PencilLine, Plus, X } from "lucide-react";
import type { FieldErrors } from "@domain/lib/action-result";
import { MAX_LINKS } from "@domain/lib/links";
import { Button, ButtonLink } from "@/components/argue/ui/button";
import { Input } from "@/components/argue/ui/input";
import { Select } from "@/components/argue/ui/select";
import { Textarea } from "@/components/argue/ui/textarea";
import { useToast } from "@/components/argue/ui/toast";
import { createArgument, updateArgument } from "@/lib/server-actions";
import type { CategoryOption } from "@domain/arguments/types";
import { ARGUMENT_LIMITS, propositionHints } from "@domain/arguments/validation";
import { ArgumentLinks } from "./argument-links";
import { PropositionBlock } from "./proposition-block";

export interface ArgumentFormValues {
  title: string;
  categorySlug: string;
  proposition: string;
  body: string;
  links: string[];
}

export type ArgumentFormProps =
  | { mode: "create"; categories: CategoryOption[]; initial?: Partial<ArgumentFormValues> }
  | { mode: "edit"; categories: CategoryOption[]; argumentId: string; initial: ArgumentFormValues };

function newKey(): string {
  return crypto.randomUUID();
}

/** Errors for one link row ("links.2"); the list-level error lives under "links". */
function linkErrors(fieldErrors: FieldErrors, index: number): string[] | undefined {
  return fieldErrors[`links.${index}`];
}

/** Copy of `errors` without the keys matching `drop`. */
function withoutErrors(errors: FieldErrors, drop: (key: string) => boolean): FieldErrors {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => !drop(key)));
}

/**
 * Create or edit an argument (PRD §8.2): title, category, proposition (with wording hints), body and up to
 * five evidence links, with a preview before publishing.
 */
export function ArgumentForm(props: ArgumentFormProps) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [pending, startTransition] = useTransition();
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [preview, setPreview] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [values, setValues] = useState<ArgumentFormValues>(() => ({
    title: props.initial?.title ?? "",
    categorySlug: props.initial?.categorySlug ?? "",
    proposition: props.initial?.proposition ?? "",
    body: props.initial?.body ?? "",
    links: props.initial?.links && props.initial.links.length > 0 ? props.initial.links : [""],
  }));

  const hints = useMemo(() => propositionHints(values.proposition), [values.proposition]);
  const category = props.categories.find((c) => c.slug === values.categorySlug);

  function update<K extends keyof ArgumentFormValues>(key: K, value: ArgumentFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((errors) => withoutErrors(errors, (k) => k === key));
  }

  function updateLink(index: number, value: string) {
    setValues((current) => ({ ...current, links: current.links.map((l, i) => (i === index ? value : l)) }));
  }

  function removeLink(index: number) {
    setValues((current) => {
      const links = current.links.filter((_, i) => i !== index);
      return { ...current, links: links.length > 0 ? links : [""] };
    });
    setFieldErrors((errors) => withoutErrors(errors, (key) => key === "links" || key.startsWith("links.")));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const payload = { ...values, links: values.links.filter((l) => l.trim().length > 0) };
    startTransition(async () => {
      let id: string;
      let message: string;
      if (props.mode === "create") {
        const result = await createArgument({ ...payload, idempotencyKey });
        if (!result.ok) return showFailure(result.error, result.fieldErrors);
        setIdempotencyKey(newKey());
        id = result.data.id;
        message = "Your argument is live. Share it and let people pick a side.";
      } else {
        const result = await updateArgument({ ...payload, argumentId: props.argumentId });
        if (!result.ok) return showFailure(result.error, result.fieldErrors);
        id = result.data.id;
        message = result.data.changed ? "Changes saved." : "Nothing changed.";
      }
      success(message);
      router.push(`/a/${id}`);
      router.refresh();
    });
  }

  function showFailure(message: string, errors: FieldErrors | undefined) {
    setFieldErrors(errors ?? {});
    setFormError(message);
    setPreview(false);
    toastError(message);
  }

  const submitLabel = props.mode === "create" ? "Publish argument" : "Save changes";
  const cancelHref = props.mode === "edit" ? `/a/${props.argumentId}` : "/";
  const filledLinks = values.links.filter((l) => l.trim().length > 0);

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6" aria-busy={pending}>
      <div hidden={preview} className="flex flex-col gap-5">
        <Input
          label="Title"
          name="title"
          value={values.title}
          onChange={(e) => update("title", e.target.value)}
          maxLength={ARGUMENT_LIMITS.titleMax}
          required
          autoComplete="off"
          placeholder="e.g. Messi is the greatest of all time"
          hint="A short headline for the feed."
          error={fieldErrors.title}
        />

        <Select
          label="Category"
          name="categorySlug"
          value={values.categorySlug}
          onChange={(e) => update("categorySlug", e.target.value)}
          placeholder="Choose a category"
          options={props.categories.map((c) => ({ value: c.slug, label: c.name }))}
          hint={category?.description}
          required
          error={fieldErrors.categorySlug}
        />

        <div className="flex flex-col gap-2">
          <Textarea
            label="Proposition"
            name="proposition"
            value={values.proposition}
            onChange={(e) => update("proposition", e.target.value)}
            maxLength={ARGUMENT_LIMITS.propositionMax}
            showCount
            rows={2}
            required
            placeholder="e.g. Lionel Messi is a better footballer than Cristiano Ronaldo."
            hint="One clear statement people can AGREE with or be AGAINST. If someone challenges you, this becomes the debate's question."
            error={fieldErrors.proposition}
          />
          <div aria-live="polite">
            {hints.length > 0 ? (
              <ul className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] bg-warning-soft px-3 py-2.5 text-sm text-ink">
                {hints.map((hint) => (
                  <li key={hint} className="flex gap-2">
                    <Lightbulb aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                    <span>{hint}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <Textarea
          label="Your argument"
          name="body"
          value={values.body}
          onChange={(e) => update("body", e.target.value)}
          maxLength={ARGUMENT_LIMITS.bodyMax}
          showCount
          rows={8}
          required
          placeholder="Make your case. Facts, examples, reasons — why should people agree?"
          error={fieldErrors.body}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold text-ink">
            Evidence links <span className="font-normal text-ink-3">(optional, up to {MAX_LINKS})</span>
          </legend>
          {values.links.map((link, index) => (
            <div key={index} className="flex items-start gap-2">
              <div className="flex-1">
                <Input
                  label={`Link ${index + 1}`}
                  hideLabel
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  value={link}
                  onChange={(e) => updateLink(index, e.target.value)}
                  placeholder="https://"
                  error={linkErrors(fieldErrors, index)}
                />
              </div>
              {values.links.length > 1 || link.length > 0 ? (
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => removeLink(index)}
                  aria-label={`Remove link ${index + 1}`}
                  className="w-11 px-0"
                  icon={<X aria-hidden className="size-4" />}
                />
              ) : null}
            </div>
          ))}
          {fieldErrors.links ? (
            <p className="text-sm font-medium text-danger" role="alert">
              {fieldErrors.links[0]}
            </p>
          ) : null}
          {values.links.length < MAX_LINKS ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              icon={<Plus aria-hidden className="size-4" />}
              onClick={() => setValues((c) => ({ ...c, links: [...c.links, ""] }))}
            >
              Add another link
            </Button>
          ) : null}
        </fieldset>
      </div>

      {preview ? (
        <section aria-label="Preview" className="flex flex-col gap-4 rounded-[var(--radius)] border border-line bg-surface p-4 sm:p-5">
          <p className="text-xs font-bold tracking-wide text-ink-3 uppercase">
            Preview{category ? ` · ${category.name}` : ""}
          </p>
          <h2 className="text-4xl leading-tight text-ink">{values.title.trim() || "Your title"}</h2>
          <PropositionBlock proposition={values.proposition.trim() || "Your proposition"} />
          <p className="whitespace-pre-wrap text-ink-2">{values.body.trim() || "Your argument"}</p>
          <ArgumentLinks links={filledLinks} />
        </section>
      ) : null}

      {formError ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}

      <p className="text-sm text-ink-3">
        {props.mode === "create"
          ? "You can edit your argument until someone's challenge on it is accepted. After that it's locked so the debate stays fair."
          : "Edits are marked as edited. Once a challenge on this argument is accepted, it locks."}
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ButtonLink href={cancelHref} variant="ghost">
          Cancel
        </ButtonLink>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            variant="secondary"
            onClick={() => setPreview((p) => !p)}
            icon={preview ? <PencilLine aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
            aria-pressed={preview}
          >
            {preview ? "Back to editing" : "Preview"}
          </Button>
          <Button type="submit" loading={pending}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
