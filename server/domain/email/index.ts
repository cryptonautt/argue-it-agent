import "server-only";

/**
 * Outgoing email, behind one small pluggable seam.
 *
 * No provider is bundled yet. `EMAIL_PROVIDER` names the one to use once it is wired in here (e.g. a Resend
 * or Postmark module that implements `EmailSender`). Until then:
 * - development / test: the message (including any links) is printed to the server console;
 * - production: a warning says no provider is configured and the email was NOT sent. Message bodies are
 *   never logged in production because they can contain sign-in or reset links.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  /** Short provider id, e.g. "resend". */
  id: string;
  send(message: EmailMessage): Promise<void>;
}

export type SendEmailResult =
  | { delivered: true; provider: string }
  | { delivered: false; reason: "logged" | "no_provider" };

/** Providers that `EMAIL_PROVIDER` can select. Add real implementations here (none are bundled yet). */
const PROVIDERS: Record<string, () => EmailSender> = {};

const globalForEmail = globalThis as unknown as { __argueItEmailSender?: EmailSender | null };

/**
 * Tests / wiring: route every email through `sender` (or `null` to go back to the env-selected provider).
 */
export function setEmailSender(sender: EmailSender | null): void {
  globalForEmail.__argueItEmailSender = sender;
}

function configuredSender(): EmailSender | null {
  if (globalForEmail.__argueItEmailSender) return globalForEmail.__argueItEmailSender;
  const provider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (!provider) return null;
  const create = PROVIDERS[provider];
  if (!create) {
    console.warn(`[email] EMAIL_PROVIDER="${provider}" is not a supported provider; treating email as unconfigured.`);
    return null;
  }
  return create();
}

/** Send an email through the configured provider, or fall back as described above. */
export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  const sender = configuredSender();
  if (sender) {
    await sender.send(message);
    return { delivered: true, provider: sender.id };
  }

  if (process.env.NODE_ENV === "production") {
    console.warn(
      `[email] No email provider is configured (set EMAIL_PROVIDER). The email "${message.subject}" was NOT sent.`,
    );
    return { delivered: false, reason: "no_provider" };
  }

  console.info(
    [
      "[email] No email provider configured; printing the email instead (development only).",
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      "",
      message.text,
    ].join("\n"),
  );
  return { delivered: false, reason: "logged" };
}
