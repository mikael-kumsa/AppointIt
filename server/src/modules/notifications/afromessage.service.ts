import { env } from "../../config/env.js";

type AfroMessageEnvelope<T> = {
  acknowledge?: string;
  message?: string;
  errors?: string[];
  response?: T & { errors?: string[] };
};

type AfroMessageSendResponse = {
  message_id?: string;
  status?: string;
};

type AfroMessageChallengeResponse = AfroMessageSendResponse & {
  verificationId?: string;
  phone?: string;
  to?: string;
};

function endpoint(path: string) {
  return `${env.AFROMESSAGE_API_URL.replace(/\/$/, "")}/${path}`;
}

function providerError(payload: AfroMessageEnvelope<unknown>, fallback: string) {
  const errors = payload.response && typeof payload.response === "object"
    ? (payload.response as { errors?: unknown }).errors
    : undefined;
  if (Array.isArray(errors) && errors.length > 0) return errors.join(" ");
  if (Array.isArray(payload.errors) && payload.errors.length > 0) return payload.errors.join(" ");
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  const responseMessage = payload.response && typeof payload.response === "object" ? (payload.response as { message?: unknown }).message : undefined;
  return typeof responseMessage === "string" && responseMessage.trim() ? responseMessage : fallback;
}

async function readResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => ({})) as AfroMessageEnvelope<T>;
  if (!response.ok || payload.acknowledge !== "success" || !payload.response) {
    throw new Error(providerError(payload, fallback));
  }
  return payload.response;
}

export function afroMessageCallbackUrl() {
  if (!env.AFROMESSAGE_CALLBACK_URL || !env.AFROMESSAGE_CALLBACK_SECRET) return undefined;
  const url = new URL(env.AFROMESSAGE_CALLBACK_URL);
  if (env.AFROMESSAGE_CALLBACK_SECRET) url.searchParams.set("secret", env.AFROMESSAGE_CALLBACK_SECRET);
  return url.toString();
}

export async function sendAfroMessageSms(input: {
  token: string;
  identifierId?: string | null;
  senderName?: string | null;
  to: string;
  message: string;
}) {
  const url = new URL(endpoint("send"));
  if (input.identifierId) url.searchParams.set("from", input.identifierId);
  if (input.senderName) url.searchParams.set("sender", input.senderName);
  url.searchParams.set("to", input.to);
  url.searchParams.set("message", input.message);
  const callback = afroMessageCallbackUrl();
  if (callback) url.searchParams.set("callback", callback);

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${input.token}`
    }
  });
  return readResponse<AfroMessageSendResponse>(response, "AfroMessage SMS request failed");
}

export function afroMessageOtpConfigured() {
  return Boolean(env.AFROMESSAGE_API_TOKEN);
}

export async function sendAfroMessageChallenge(phone: string) {
  if (!afroMessageOtpConfigured()) {
    throw new Error("AfroMessage OTP is not configured on the platform");
  }

  const url = new URL(endpoint("challenge"));
  if (env.AFROMESSAGE_IDENTIFIER_ID) url.searchParams.set("from", env.AFROMESSAGE_IDENTIFIER_ID);
  if (env.AFROMESSAGE_SENDER_NAME) url.searchParams.set("sender", env.AFROMESSAGE_SENDER_NAME);
  url.searchParams.set("to", phone);
  url.searchParams.set("ps", " is your AppointIt verification code.");
  url.searchParams.set("sa", "1");
  url.searchParams.set("ttl", String(env.AFROMESSAGE_OTP_TTL_SECONDS));
  url.searchParams.set("len", "6");
  url.searchParams.set("t", "0");
  const callback = afroMessageCallbackUrl();
  if (callback) url.searchParams.set("callback", callback);

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${env.AFROMESSAGE_API_TOKEN!}`,
      "content-type": "application/json"
    }
  });
  const result = await readResponse<AfroMessageChallengeResponse>(response, "Could not send verification code");
  if (!result.verificationId) throw new Error("AfroMessage did not return a verification ID");
  return result;
}

export async function verifyAfroMessageChallenge(verificationId: string, code: string) {
  if (!afroMessageOtpConfigured()) {
    throw new Error("AfroMessage OTP is not configured on the platform");
  }
  const url = new URL(endpoint("verify"));
  url.searchParams.set("vc", verificationId);
  url.searchParams.set("code", code);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${env.AFROMESSAGE_API_TOKEN!}`,
      "content-type": "application/json"
    }
  });
  return readResponse<AfroMessageChallengeResponse>(response, "Verification code is invalid or expired");
}
