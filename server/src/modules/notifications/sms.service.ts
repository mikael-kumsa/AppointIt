import { env } from "../../config/env.js";
import { sendAfroMessageSms } from "./afromessage.service.js";
import { normalizePhoneNumber } from "../../utils/phone.js";

export type SmsSendInput = {
  to: string;
  message: string;
  from?: string | null;
  vendorId: string;
  appointmentId?: string;
  provider?: string | null;
  gatewayUrl?: string | null;
  apiKey?: string | null;
  identifierId?: string | null;
};

export type SmsSendResult = {
  providerMessageId?: string;
};

export async function sendSms(input: SmsSendInput): Promise<SmsSendResult> {
  input = { ...input, to: normalizePhoneNumber(input.to) };
  const provider = input.provider || env.SMS_PROVIDER;
  if (provider === "afromessage") {
    return sendViaAfroMessage(input);
  }
  if (provider === "geez") {
    return sendGeezSms(input);
  }

  if (provider !== "http") {
    throw new Error(`Unsupported SMS provider: ${provider}`);
  }

  return sendHttpGatewaySms(input);
}

async function sendViaAfroMessage(input: SmsSendInput): Promise<SmsSendResult> {
  if (!input.apiKey) throw new Error("Vendor AfroMessage API token is not configured");
  const response = await sendAfroMessageSms({
    token: input.apiKey,
    identifierId: input.identifierId,
    senderName: input.from,
    to: input.to,
    message: input.message
  });
  return { providerMessageId: response.message_id };
}

async function sendHttpGatewaySms(input: SmsSendInput): Promise<SmsSendResult> {
  const gatewayUrl = input.gatewayUrl || env.SMS_GATEWAY_URL;
  if (!gatewayUrl) throw new Error("SMS gateway URL is not configured");

  const apiKey = input.apiKey || env.SMS_GATEWAY_API_KEY;
  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({
      to: input.to,
      message: input.message,
      from: input.from || env.SMS_FROM,
      vendorId: input.vendorId,
      appointmentId: input.appointmentId
    })
  });

  const payload = await response.json().catch(() => ({})) as { id?: string; messageId?: string; error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "SMS gateway request failed");
  }
  return { providerMessageId: payload.messageId ?? payload.id };
}

function nestedValue(payload: unknown, path: string | undefined): unknown {
  if (!payload || !path || typeof payload !== "object") {
    return undefined;
  }

  return path.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    return (value as Record<string, unknown>)[segment];
  }, payload);
}

function buildGeezAuthHeaders(apiKey?: string | null): Record<string, string> {
  if (!apiKey) {
    return {};
  }

  const header = env.GEEZ_SMS_AUTH_HEADER;
  const scheme = env.GEEZ_SMS_AUTH_SCHEME;
  if (scheme.toLowerCase() === "none") {
    return { [header]: apiKey };
  }

  return {
    [header]: scheme ? `${scheme} ${apiKey}` : apiKey
  };
}

function pickMessageId(payload: Record<string, unknown>): string | undefined {
  const configuredValue = nestedValue(payload, env.GEEZ_SMS_MESSAGE_ID_FIELD);
  const fallback =
    payload.messageId ??
    payload.id ??
    payload.requestId ??
    payload.reference ??
    nestedValue(payload, "data.messageId") ??
    nestedValue(payload, "data.id");

  const value = configuredValue ?? fallback;
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

async function sendGeezSms(input: SmsSendInput): Promise<SmsSendResult> {
  const apiUrl = input.gatewayUrl || env.GEEZ_SMS_API_URL;
  if (!apiUrl) throw new Error("GE'EZ SMS API URL is not configured");

  const apiKey = input.apiKey || env.GEEZ_SMS_API_KEY;
  if (!apiKey) throw new Error("GE'EZ SMS API key is not configured");

  const sender = input.from || env.GEEZ_SMS_SENDER_ID || env.SMS_FROM;
  const body = {
    [env.GEEZ_SMS_TO_FIELD]: input.to,
    [env.GEEZ_SMS_MESSAGE_FIELD]: input.message,
    [env.GEEZ_SMS_SENDER_FIELD]: sender
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...buildGeezAuthHeaders(apiKey)
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const providerError =
    payload.error ??
    payload.message ??
    payload.errorMessage ??
    nestedValue(payload, "data.error");

  if (!response.ok) {
    throw new Error(typeof providerError === "string" ? providerError : "GE'EZ SMS request failed");
  }

  if (env.GEEZ_SMS_SUCCESS_FIELD) {
    const successValue = nestedValue(payload, env.GEEZ_SMS_SUCCESS_FIELD);
    if (successValue === false || successValue === "false" || successValue === 0 || successValue === "0") {
      throw new Error(typeof providerError === "string" ? providerError : "GE'EZ SMS provider returned an unsuccessful response");
    }
  }

  return { providerMessageId: pickMessageId(payload) };
}
