import type { ReactNode } from "react";

/** Standard page width + gutters. `wide` for admin tables and two-column layouts. */
export function PageContainer({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={wide ? "mx-auto max-w-6xl px-4 pt-6" : "mx-auto max-w-[var(--content-max)] px-4 pt-6"}>{children}</div>;
}

/** Page title block. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-4xl text-ink sm:text-5xl">{title}</h1>
        {description ? <p className="mt-2 max-w-prose text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}
