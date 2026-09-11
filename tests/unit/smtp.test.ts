// @vitest-environment node
import { expect, it, vi } from "vitest";
import { sendSmtp, smtpOptions } from "../../supabase/functions/_shared/smtp";
const mail = {
  from: "invoice@posinventory.store",
  to: ["info@posinventory.store"],
  subject: "Test",
  text: "Test",
  attachments: [{ filename: "test.pdf", content: "YQ==" }],
};
it("requires credentials and uses certificate-verified Hostinger TLS", () => {
  expect(smtpOptions(() => undefined)).toBeNull();
  expect(
    smtpOptions(
      (key) =>
        (
          ({
            SMTP_USER: "info@posinventory.store",
            SMTP_PASSWORD: "test",
          }) as Record<string, string>
        )[key],
    ),
  ).toMatchObject({
    host: "smtp.hostinger.com",
    port: 465,
    secure: true,
    tls: { rejectUnauthorized: true },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
});
it("reserves before sending, encodes attachments and records acceptance", async () => {
  const ledger = {
    begin: vi.fn(async () => ({ token: "token" })),
    finish: vi.fn(async () => {}),
  };
  const deliver = vi.fn(async (_mail: unknown) => (void _mail, {
    accepted: mail.to,
    messageId: "receipt",
  }));
  expect(await sendSmtp("report-job", mail, ledger, deliver)).toEqual({
    id: "receipt",
  });
  expect(deliver.mock.calls[0][0]).toMatchObject({
    attachments: [
      { filename: "test.pdf", content: "YQ==", encoding: "base64" },
    ],
  });
  expect(ledger.finish).toHaveBeenCalledWith("report-job", "token", "receipt");
});
it("reconciles an accepted delivery without sending it again", async () => {
  const deliver = vi.fn();
  expect(
    await sendSmtp(
      "report-job",
      mail,
      { begin: async () => ({ provider: "receipt" }), finish: vi.fn() },
      deliver,
    ),
  ).toEqual({ id: "receipt" });
  expect(deliver).not.toHaveBeenCalled();
});
it("blocks concurrent or uncertain attempts and hides SMTP error details", async () => {
  const deliver = vi.fn(async () => {
    throw new Error("credential in upstream response");
  });
  const ledger = {
    begin: vi
      .fn()
      .mockResolvedValueOnce({ token: "token" })
      .mockResolvedValue({}),
    finish: vi.fn(),
  };
  await expect(sendSmtp("report-job", mail, ledger, deliver)).rejects.toThrow(
    "SMTP_DELIVERY_UNCERTAIN",
  );
  await expect(sendSmtp("report-job", mail, ledger, deliver)).rejects.toThrow(
    "SMTP_DELIVERY_UNCERTAIN",
  );
  expect(deliver).toHaveBeenCalledTimes(1);
  expect(ledger.finish).not.toHaveBeenCalled();
});
it("does not mark a rejected recipient accepted", async () => {
  const finish = vi.fn();
  await expect(
    sendSmtp(
      "report-job",
      mail,
      { begin: async () => ({ token: "token" }), finish },
      async () => ({ accepted: [], messageId: "none" }),
    ),
  ).rejects.toThrow("SMTP_DELIVERY_UNCERTAIN");
  expect(finish).not.toHaveBeenCalled();
});
