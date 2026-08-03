import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubGlobal("fetch", vi.fn());
});

describe("sendSms", () => {
  it("sends through AfroMessage with vendor-scoped credentials and sender identity", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://appointit:appointit@localhost:5433/appointit?schema=public");
    vi.stubEnv("SMS_PROVIDER", "afromessage");
    vi.stubEnv("AFROMESSAGE_API_URL", "https://api.afromessage.test/api");
    vi.stubEnv("AFROMESSAGE_CALLBACK_URL", "https://api.appointit.test/api/webhooks/afromessage/status");
    vi.stubEnv("AFROMESSAGE_CALLBACK_SECRET", "callback-secret");

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ acknowledge: "success", response: { message_id: "afro-1", status: "Send in progress" } })
    } as Response);

    const { sendSms } = await import("../src/modules/notifications/sms.service.js");
    const result = await sendSms({
      to: "+251911000001",
      message: "Appointment reminder",
      from: "SelamDental",
      vendorId: "vendor-1",
      provider: "afromessage",
      apiKey: "vendor-token",
      identifierId: "vendor-identifier"
    });

    expect(result.providerMessageId).toBe("afro-1");
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    const requestUrl = new URL(String(url));
    expect(requestUrl.origin + requestUrl.pathname).toBe("https://api.afromessage.test/api/send");
    expect(requestUrl.searchParams.get("from")).toBe("vendor-identifier");
    expect(requestUrl.searchParams.get("sender")).toBe("SelamDental");
    expect(requestUrl.searchParams.get("to")).toBe("+251911000001");
    expect(requestUrl.searchParams.get("message")).toBe("Appointment reminder");
    expect(requestUrl.searchParams.get("callback")).toBe("https://api.appointit.test/api/webhooks/afromessage/status?secret=callback-secret");
    expect(options).toEqual({ headers: { authorization: "Bearer vendor-token" } });
  });

  it("sends through AfroMessage when sender name is not configured", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://appointit:appointit@localhost:5433/appointit?schema=public");
    vi.stubEnv("SMS_PROVIDER", "afromessage");
    vi.stubEnv("AFROMESSAGE_API_URL", "https://api.afromessage.test/api");

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ acknowledge: "success", response: { message_id: "afro-2", status: "Send in progress" } })
    } as Response);

    const { sendSms } = await import("../src/modules/notifications/sms.service.js");
    const result = await sendSms({
      to: "+251911000001",
      message: "Appointment reminder",
      vendorId: "vendor-1",
      provider: "afromessage",
      apiKey: "vendor-token",
      identifierId: "vendor-identifier"
    });

    expect(result.providerMessageId).toBe("afro-2");
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    const requestUrl = new URL(String(url));
    expect(requestUrl.origin + requestUrl.pathname).toBe("https://api.afromessage.test/api/send");
    expect(requestUrl.searchParams.get("from")).toBe("vendor-identifier");
    expect(requestUrl.searchParams.get("to")).toBe("+251911000001");
    expect(requestUrl.searchParams.get("message")).toBe("Appointment reminder");
    expect(requestUrl.searchParams.has("sender")).toBe(false);
    expect(options).toEqual({ headers: { authorization: "Bearer vendor-token" } });
  });


  it("sends through GE'EZ with configurable request fields and auth", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://appointit:appointit@localhost:5433/appointit?schema=public");
    vi.stubEnv("SMS_PROVIDER", "geez");
    vi.stubEnv("GEEZ_SMS_API_URL", "https://sms.geez.example/api/send");
    vi.stubEnv("GEEZ_SMS_API_KEY", "geez-key");
    vi.stubEnv("GEEZ_SMS_SENDER_ID", "AppointIt");
    vi.stubEnv("GEEZ_SMS_AUTH_HEADER", "X-API-Key");
    vi.stubEnv("GEEZ_SMS_AUTH_SCHEME", "none");
    vi.stubEnv("GEEZ_SMS_TO_FIELD", "phone");
    vi.stubEnv("GEEZ_SMS_MESSAGE_FIELD", "text");
    vi.stubEnv("GEEZ_SMS_SENDER_FIELD", "sender_id");
    vi.stubEnv("GEEZ_SMS_MESSAGE_ID_FIELD", "data.id");
    vi.stubEnv("GEEZ_SMS_SUCCESS_FIELD", "success");

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: "geez-1" } })
    } as Response);

    const { sendSms } = await import("../src/modules/notifications/sms.service.js");
    const result = await sendSms({
      to: "+251911000001",
      message: "Appointment reminder",
      vendorId: "vendor-1"
    });

    expect(result.providerMessageId).toBe("geez-1");
    expect(fetch).toHaveBeenCalledWith("https://sms.geez.example/api/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-API-Key": "geez-key"
      },
      body: JSON.stringify({
        phone: "+251911000001",
        text: "Appointment reminder",
        sender_id: "AppointIt"
      })
    });
  });

  it("keeps the generic HTTP gateway provider available", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://appointit:appointit@localhost:5433/appointit?schema=public");
    vi.stubEnv("SMS_PROVIDER", "http");
    vi.stubEnv("SMS_GATEWAY_URL", "http://localhost:4100/send-sms");
    vi.stubEnv("SMS_GATEWAY_API_KEY", "gateway-key");

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ messageId: "gateway-1" })
    } as Response);

    const { sendSms } = await import("../src/modules/notifications/sms.service.js");
    const result = await sendSms({
      to: "+251911000001",
      message: "Appointment reminder",
      vendorId: "vendor-1",
      appointmentId: "appt-1"
    });

    expect(result.providerMessageId).toBe("gateway-1");
    expect(fetch).toHaveBeenCalledWith("http://localhost:4100/send-sms", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer gateway-key" })
    }));
  });
});
