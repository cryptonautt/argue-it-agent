"use client";

import { useState } from "react";
import { Copy, MessageCircle, Share2 } from "lucide-react";
import { Button } from "@/components/argue/ui/button";
import { Dialog } from "@/components/argue/ui/dialog";
import { useToast } from "@/components/argue/ui/toast";

export interface ShareButtonProps {
  /** Site-relative path, e.g. /a/123. The absolute URL is built from the current origin. */
  path: string;
  title: string;
  /** Short text shared alongside the link (e.g. the proposition). */
  text: string;
}

function shareMessage(text: string, url: string): string {
  return `${text}\n\nAGREE or AGAINST? ${url}`;
}

/**
 * Share an argument link. Uses the phone's native share sheet when available (WhatsApp, X, etc. without
 * extra scripts); otherwise offers copy-link, WhatsApp and X.
 */
export function ShareButton({ path, title, text }: ShareButtonProps) {
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");

  async function handleShare() {
    const absolute = new URL(path, window.location.origin).toString();
    setUrl(absolute);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: `${text}\n\nAGREE or AGAINST?`, url: absolute });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Fall through to the dialog when the share sheet is unavailable.
      }
    }
    setOpen(true);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      success("Link copied");
      setOpen(false);
    } catch {
      error("Couldn't copy automatically — press and hold the link to copy it.");
    }
  }

  const encoded = encodeURIComponent(shareMessage(text, url));
  return (
    <>
      <Button variant="ghost" size="sm" onClick={handleShare} icon={<Share2 aria-hidden className="size-4" />}>
        Share
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Share this argument" description="Get more people to pick a side.">
        <div className="flex flex-col gap-3">
          <p className="rounded-[var(--radius-sm)] bg-surface-2 px-3 py-2 text-sm break-all text-ink-2 select-all">{url}</p>
          <Button onClick={copyLink} variant="primary" fullWidth icon={<Copy aria-hidden className="size-4" />}>
            Copy link
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <a
              href={`https://wa.me/?text=${encoded}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius)] border border-line-strong bg-surface font-semibold text-ink hover:bg-surface-2"
            >
              <MessageCircle aria-hidden className="size-4" />
              WhatsApp
            </a>
            <a
              href={`https://x.com/intent/post?text=${encoded}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius)] border border-line-strong bg-surface font-semibold text-ink hover:bg-surface-2"
            >
              Post on X
            </a>
          </div>
        </div>
      </Dialog>
    </>
  );
}
