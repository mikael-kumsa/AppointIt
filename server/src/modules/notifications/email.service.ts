import nodemailer from "nodemailer";
import { env } from "../../config/env.js";

export type PlatformEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export function isSmtpConfigured() {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

function smtpTransport() {
  if (!isSmtpConfigured()) throw new Error("SMTP is not configured");
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000
  });
}

function platformSender() {
  if (env.SMTP_FROM.includes("@appointit.local") && env.SMTP_USER) {
    return `AppointIt <${env.SMTP_USER}>`;
  }
  return env.SMTP_FROM;
}

export async function sendPlatformEmail(message: PlatformEmail) {
  const result = await smtpTransport().sendMail({
    from: platformSender(),
    ...message
  });
  const accepted = result.accepted.map(String);
  const rejected = result.rejected.map(String);
  if (accepted.length === 0) {
    throw new Error(`SMTP did not accept the recipient${result.response ? `: ${result.response}` : ""}`);
  }
  return { messageId: result.messageId, accepted, rejected, response: result.response };
}
