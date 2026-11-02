"use client";

// Owner: verdict. Share the verdict: native share sheet on phones (WhatsApp, X…), copy link elsewhere.
import { Share2 } from "lucide-react";
import { Button } from "@/components/argue/ui/button";
import { useToast } from "@/components/argue/ui/toast";

export function ShareVerdictButton({ path, title }: { path: string; title: string }) {
  const { success, error } = useToast();

  async function share() {
    const url = new URL(path, window.location.origin).toString();
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, text: `${title} — the AI verdict is in`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      success("Link copied");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // user closed the share sheet
      error("Couldn't share. Copy the link from your address bar.");
    }
  }

  return (
    <Button variant="judge" icon={<Share2 aria-hidden className="size-4" />} onClick={share}>
      Share the verdict
    </Button>
  );
}
