import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const args = process.argv.slice(2);
const domainIndex = args.indexOf("--domain");
const domain = domainIndex >= 0 ? args[domainIndex + 1]?.trim().toLowerCase() : "";
const force = args.includes("--force");

if (!domain || !/^[a-z0-9.-]+$/.test(domain)) {
  throw new Error("Usage: node scripts/create-production-env.mjs --domain app.example.com [--force]");
}

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(root, ".env");
const templatePath = path.join(root, ".env.production.example");
const outputPath = path.join(root, ".env.production");

if (fs.existsSync(outputPath) && !force) {
  throw new Error(".env.production already exists. Pass --force to replace it.");
}

const source = fs.existsSync(sourcePath) ? dotenv.parse(fs.readFileSync(sourcePath)) : {};
const template = dotenv.parse(fs.readFileSync(templatePath));
const origin = `https://${domain}`;
const databasePassword = crypto.randomBytes(24).toString("hex");
const redisPassword = crypto.randomBytes(24).toString("hex");
const secret = (bytes = 48) => crypto.randomBytes(bytes).toString("base64url");

const generated = {
  APP_DOMAIN: domain,
  APP_ORIGIN: origin,
  PASSWORD_RESET_ORIGIN: origin,
  PLATFORM_DOMAIN: domain,
  API_PORT: "4201",
  POSTGRES_PASSWORD: databasePassword,
  DATABASE_URL: `postgresql://appointit:${databasePassword}@postgres:5432/appointit?schema=public`,
  REDIS_PASSWORD: redisPassword,
  REDIS_URL: `redis://:${redisPassword}@redis:6379`,
  JWT_ACCESS_SECRET: secret(),
  JWT_REFRESH_SECRET: secret(),
  TOKEN_ENCRYPTION_KEY: secret(32),
  AFROMESSAGE_CALLBACK_URL: `${origin}/api/webhooks/afromessage/status`,
  AFROMESSAGE_CALLBACK_SECRET: secret(32),
  TELEBIRR_SMS_GATEWAY_SECRET: secret(32),
  GOOGLE_REDIRECT_URI: `${origin}/api/calendar/google/callback`,
  TELEGRAM_REDIRECT_URI: `${origin}/api/telegram/login/callback`,
  CUSTOM_DOMAIN_CNAME_TARGET: domain
};

const values = { ...template, ...source, ...generated };
const lines = Object.keys(template).map((key) => `${key}=${JSON.stringify(values[key] ?? "")}`);
fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
console.log(`Created .env.production for ${domain}.`);
