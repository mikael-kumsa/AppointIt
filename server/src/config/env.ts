import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const configDir = path.dirname(fileURLToPath(import.meta.url));

function findWorkspaceRoot(start: string) {
  let current = start;
  while (true) {
    const packagePath = path.join(current, "package.json");
    if (fs.existsSync(packagePath)) {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { workspaces?: unknown };
      if (Array.isArray(packageJson.workspaces)) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Could not locate the AppointIt workspace root");
    current = parent;
  }
}

const workspaceRoot = findWorkspaceRoot(configDir);

for (const envPath of [path.join(workspaceRoot, ".env"), path.join(workspaceRoot, "server", ".env")]) {
  if (!fs.existsSync(envPath)) continue;
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]?.trim() && value.trim()) process.env[key] = value;
  }
}

const trimmedOptional = z.preprocess((value) => typeof value === "string" ? value.trim() || undefined : value, z.string().optional());
const trimmedDefault = (fallback: string) => z.preprocess((value) => typeof value === "string" ? value.trim() || undefined : value, z.string().default(fallback));

const schema = z.object({
  DATABASE_URL: z.string().trim().min(1),
  REDIS_URL: trimmedDefault("redis://localhost:6379"),
  JWT_ACCESS_SECRET: trimmedDefault("dev-access-secret-change-me"),
  JWT_REFRESH_SECRET: trimmedDefault("dev-refresh-secret-change-me"),
  TOKEN_ENCRYPTION_KEY: trimmedDefault("dev-encryption-key-change-me-32"),
  APP_ORIGIN: trimmedDefault("http://localhost:4200"),
  PASSWORD_RESET_ORIGIN: trimmedOptional,
  PLATFORM_DOMAIN: trimmedDefault("appointit.com"),
  API_PORT: z.coerce.number().default(4201),
  CUSTOM_DOMAIN_PROVIDER: z.enum(["manual", "cloudflare"]).default("manual"),
  CUSTOM_DOMAIN_CNAME_TARGET: trimmedDefault("domains.appointit.com"),
  CUSTOM_DOMAIN_A_TARGET: trimmedOptional,
  CLOUDFLARE_API_TOKEN: trimmedOptional,
  CLOUDFLARE_ZONE_ID: trimmedOptional,
  GOOGLE_CLIENT_ID: trimmedOptional,
  GOOGLE_CLIENT_SECRET: trimmedOptional,
  GOOGLE_REDIRECT_URI: trimmedOptional,
  TELEGRAM_CLIENT_ID: trimmedOptional,
  TELEGRAM_CLIENT_SECRET: trimmedOptional,
  TELEGRAM_REDIRECT_URI: trimmedDefault("http://localhost:4201/api/telegram/login/callback"),
  SMTP_HOST: trimmedOptional,
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: trimmedOptional,
  SMTP_PASS: trimmedOptional,
  SMTP_FROM: trimmedDefault("AppointIt <no-reply@appointit.local>"),
  SMS_PROVIDER: trimmedDefault("afromessage"),
  SMS_GATEWAY_URL: trimmedOptional,
  SMS_GATEWAY_API_KEY: trimmedOptional,
  SMS_FROM: trimmedDefault("AppointIt"),
  AFROMESSAGE_API_URL: trimmedDefault("https://api.afromessage.com/api"),
  AFROMESSAGE_API_TOKEN: trimmedOptional,
  AFROMESSAGE_IDENTIFIER_ID: trimmedOptional,
  AFROMESSAGE_SENDER_NAME: trimmedOptional,
  AFROMESSAGE_CALLBACK_URL: trimmedOptional,
  AFROMESSAGE_CALLBACK_SECRET: trimmedOptional,
  AFROMESSAGE_OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  TELEBIRR_PAYMENT_PHONE: trimmedDefault("+251900000000"),
  TELEBIRR_SMS_GATEWAY_SECRET: trimmedOptional,
  PAYMENT_INVOICE_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  GEEZ_SMS_API_URL: trimmedOptional,
  GEEZ_SMS_API_KEY: trimmedOptional,
  GEEZ_SMS_SENDER_ID: trimmedOptional,
  GEEZ_SMS_AUTH_HEADER: trimmedDefault("Authorization"),
  GEEZ_SMS_AUTH_SCHEME: trimmedDefault("Bearer"),
  GEEZ_SMS_TO_FIELD: trimmedDefault("to"),
  GEEZ_SMS_MESSAGE_FIELD: trimmedDefault("message"),
  GEEZ_SMS_SENDER_FIELD: trimmedDefault("sender"),
  GEEZ_SMS_MESSAGE_ID_FIELD: trimmedDefault("messageId"),
  GEEZ_SMS_SUCCESS_FIELD: trimmedOptional
});

export const env = schema.parse(process.env);
