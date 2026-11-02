import { ExternalLink } from "lucide-react";
import { LINK_REL, displayLink, isSafeLink } from "@domain/lib/links";

/** Evidence links on an argument. Re-validated at render; always rel="nofollow ugc noopener noreferrer". */
export function ArgumentLinks({ links }: { links: readonly string[] }) {
  const safe = links.filter(isSafeLink);
  if (safe.length === 0) return null;
  return (
    <section aria-labelledby="argument-links-heading">
      <h2 id="argument-links-heading" className="text-sm font-semibold text-ink-3">
        Sources &amp; links
      </h2>
      <ul className="mt-2 flex flex-col gap-1.5">
        {safe.map((href) => (
          <li key={href}>
            <a
              href={href}
              rel={LINK_REL}
              target="_blank"
              className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium break-all text-for-strong underline-offset-2 hover:underline"
            >
              <ExternalLink aria-hidden className="size-3.5 shrink-0" />
              {displayLink(href)}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
