import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail, setEmailSender, type EmailMessage } from "./index";

const message: EmailMessage = {
  to: "ada@example.test",
  subject: "Reset your ARGUE IT password",
  text: "Set a new password: https://argueit.test/api/auth/reset-password/tok123",
};

afterEach(() => {
  setEmailSender(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sendEmail without a provider", () => {
  it.each(["development", "test"])("prints the whole email (with links) in %s", async (env) => {
    vi.stubEnv("NODE_ENV", env);
    vi.stubEnv("EMAIL_PROVIDER", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await sendEmail(message);
    expect(result).toEqual({ delivered: false, reason: "logged" });
    const logged = info.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("To: ada@example.test");
    expect(logged).toContain("https://argueit.test/api/auth/reset-password/tok123");
  });

  it("warns in production that nothing was sent, without logging the body or link", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_PROVIDER", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await sendEmail(message);
    expect(result).toEqual({ delivered: false, reason: "no_provider" });
    expect(info).not.toHaveBeenCalled();
    const warned = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warned).toMatch(/No email provider is configured/);
    expect(warned).toMatch(/NOT sent/);
    expect(warned).not.toContain("tok123");
    expect(warned).not.toContain("ada@example.test");
  });

  it("treats an unsupported EMAIL_PROVIDER as unconfigured (and says so)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_PROVIDER", "carrier-pigeon");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await sendEmail(message);
    expect(result).toEqual({ delivered: false, reason: "no_provider" });
    const warned = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warned).toContain('EMAIL_PROVIDER="carrier-pigeon" is not a supported provider');
  });
});

describe("sendEmail with a sender", () => {
  it("delivers through the plugged-in sender", async () => {
    const sent: EmailMessage[] = [];
    setEmailSender({ id: "capture", send: async (m) => void sent.push(m) });
    const result = await sendEmail(message);
    expect(result).toEqual({ delivered: true, provider: "capture" });
    expect(sent).toEqual([message]);
  });

  it("lets provider errors propagate (callers decide how to handle them)", async () => {
    setEmailSender({
      id: "broken",
      send: async () => {
        throw new Error("smtp down");
      },
    });
    await expect(sendEmail(message)).rejects.toThrow("smtp down");
  });
});
