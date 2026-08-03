import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

export type SmsGatewayProviderName = "mock" | "spool";

export type SmsGatewayConfig = {
  port: number;
  apiKey: string;
  provider: SmsGatewayProviderName;
  spoolDir: string;
  logFile: string;
  maxBodyBytes: number;
  rateLimitPerMinute: number;
  defaultFrom: string;
};

function readInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readProvider(): SmsGatewayProviderName {
  const value = process.env.SMS_GATEWAY_PROVIDER?.trim().toLowerCase();
  return value === "spool" ? "spool" : "mock";
}

function loadEnvironment(): void {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const packageRoot = currentDir.endsWith(join("dist", "src"))
    ? dirname(dirname(currentDir))
    : dirname(currentDir);
  const repoRoot = dirname(packageRoot);
  const candidates = [join(packageRoot, ".env"), join(repoRoot, ".env")];

  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path, override: false });
    }
  }
}

export function readConfig(): SmsGatewayConfig {
  loadEnvironment();

  return {
    port: readInt("SMS_GATEWAY_PORT", 4100),
    apiKey: process.env.SMS_GATEWAY_API_KEY || "change-me",
    provider: readProvider(),
    spoolDir: process.env.SMS_GATEWAY_SPOOL_DIR || "data/outbox",
    logFile: process.env.SMS_GATEWAY_LOG_FILE || "data/messages.jsonl",
    maxBodyBytes: readInt("SMS_GATEWAY_MAX_BODY_BYTES", 32_768),
    rateLimitPerMinute: readInt("SMS_GATEWAY_RATE_LIMIT_PER_MINUTE", 120),
    defaultFrom: process.env.SMS_GATEWAY_DEFAULT_FROM || "AppointIt"
  };
}
