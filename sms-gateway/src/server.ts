import { timingSafeEqual, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { readConfig, type SmsGatewayConfig } from "./config.js";
import { SmsLogStore } from "./log-store.js";
import { createProvider } from "./providers.js";
import type { SmsProvider, SmsRecord, SmsSendRequest } from "./types.js";

type JsonValue = Record<string, unknown> | unknown[];

type SmsGatewayDeps = {
  config?: SmsGatewayConfig;
  provider?: SmsProvider;
  store?: SmsLogStore;
};

type RateBucket = {
  count: number;
  resetAt: number;
};

const rateBuckets = new Map<string, RateBucket>();

function sendJson(response: ServerResponse, statusCode: number, body: JsonValue): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(request: IncomingMessage, apiKey: string): boolean {
  const header = request.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && Boolean(token) && safeEqual(token, apiKey);
}

function getClientKey(request: IncomingMessage): string {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0].trim();
  }

  return request.socket.remoteAddress || "unknown";
}

function checkRateLimit(request: IncomingMessage, config: SmsGatewayConfig): boolean {
  const now = Date.now();
  const key = getClientKey(request);
  const bucket = rateBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  bucket.count += 1;
  return bucket.count <= config.rateLimitPerMinute;
}

async function readJsonBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;

    if (size > maxBodyBytes) {
      throw new Error("request_body_too_large");
    }

    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  if (!body.trim()) {
    return {};
  }

  return JSON.parse(body);
}

function normalizePhoneNumber(phone: string): string {
  return phone.replace(/[\s-]/g, "").trim();
}

function validateSmsRequest(input: unknown): { ok: true; value: SmsSendRequest } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Body must be a JSON object." };
  }

  const body = input as Record<string, unknown>;
  if (typeof body.to !== "string") {
    return { ok: false, error: "`to` is required." };
  }

  if (typeof body.message !== "string") {
    return { ok: false, error: "`message` is required." };
  }

  const to = normalizePhoneNumber(body.to);
  const message = body.message.trim();

  if (!/^\+?[0-9]{6,15}$/.test(to)) {
    return { ok: false, error: "`to` must be an E.164-like phone number." };
  }

  if (message.length < 1 || message.length > 1000) {
    return { ok: false, error: "`message` must be between 1 and 1000 characters." };
  }

  return {
    ok: true,
    value: {
      to,
      message,
      from: typeof body.from === "string" ? body.from.trim().slice(0, 32) : undefined,
      vendorId: typeof body.vendorId === "string" ? body.vendorId : undefined,
      appointmentId: typeof body.appointmentId === "string" ? body.appointmentId : undefined
    }
  };
}

export function createSmsGatewayServer(deps: SmsGatewayDeps = {}) {
  const config = deps.config || readConfig();
  const provider = deps.provider || createProvider(config);
  const store = deps.store || new SmsLogStore(config.logFile);

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, name: "AppointIt SMS Gateway", provider: provider.name });
        return;
      }

      if (!isAuthorized(request, config.apiKey)) {
        sendJson(response, 401, { ok: false, error: "Unauthorized." });
        return;
      }

      if (!checkRateLimit(request, config)) {
        sendJson(response, 429, { ok: false, error: "Rate limit exceeded." });
        return;
      }

      if (request.method === "POST" && url.pathname === "/send-sms") {
        const body = await readJsonBody(request, config.maxBodyBytes);
        const validation = validateSmsRequest(body);

        if (!validation.ok) {
          sendJson(response, 400, { ok: false, error: validation.error });
          return;
        }

        const now = new Date().toISOString();
        const record: SmsRecord = {
          id: randomUUID(),
          to: validation.value.to,
          from: validation.value.from || config.defaultFrom,
          message: validation.value.message,
          vendorId: validation.value.vendorId,
          appointmentId: validation.value.appointmentId,
          provider: provider.name,
          status: "queued",
          createdAt: now,
          updatedAt: now
        };

        try {
          const result = await provider.send(record);
          const sentRecord: SmsRecord = {
            ...record,
            status: "sent",
            providerMessageId: result.providerMessageId,
            updatedAt: new Date().toISOString()
          };

          await store.append(sentRecord);
          sendJson(response, 202, {
            ok: true,
            id: sentRecord.id,
            messageId: sentRecord.providerMessageId,
            status: sentRecord.status
          });
        } catch (error) {
          const failedRecord: SmsRecord = {
            ...record,
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown provider error.",
            updatedAt: new Date().toISOString()
          };

          await store.append(failedRecord);
          sendJson(response, 502, { ok: false, id: failedRecord.id, error: failedRecord.error });
        }

        return;
      }

      if (request.method === "GET" && url.pathname === "/messages") {
        const limit = Number.parseInt(url.searchParams.get("limit") || "100", 10);
        sendJson(response, 200, { ok: true, messages: await store.list(Number.isFinite(limit) ? limit : 100) });
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/messages/")) {
        const id = decodeURIComponent(url.pathname.replace("/messages/", ""));
        const message = await store.findById(id);
        if (!message) {
          sendJson(response, 404, { ok: false, error: "Message not found." });
          return;
        }

        sendJson(response, 200, { ok: true, message });
        return;
      }

      sendJson(response, 404, { ok: false, error: "Not found." });
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { ok: false, error: "Invalid JSON body." });
        return;
      }

      if (error instanceof Error && error.message === "request_body_too_large") {
        sendJson(response, 413, { ok: false, error: "Request body too large." });
        return;
      }

      sendJson(response, 500, { ok: false, error: "Internal server error." });
    }
  });
}

if (process.env.NODE_ENV !== "test") {
  const config = readConfig();
  const server = createSmsGatewayServer({ config });
  server.listen(config.port, () => {
    console.log(`AppointIt SMS Gateway listening on http://localhost:${config.port}`);
  });
}
