import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { SmsGatewayConfig } from "./config.js";
import { atomicWriteFile } from "./log-store.js";
import type { SmsProvider, SmsProviderResult, SmsRecord } from "./types.js";

export function createProvider(config: SmsGatewayConfig): SmsProvider {
  if (config.provider === "spool") {
    return new SpoolSmsProvider(config.spoolDir);
  }

  return new MockSmsProvider();
}

class MockSmsProvider implements SmsProvider {
  readonly name = "mock";

  async send(record: SmsRecord): Promise<SmsProviderResult> {
    return { providerMessageId: `mock_${record.id}` };
  }
}

class SpoolSmsProvider implements SmsProvider {
  readonly name = "spool";

  constructor(private readonly spoolDir: string) {}

  async send(record: SmsRecord): Promise<SmsProviderResult> {
    await mkdir(this.spoolDir, { recursive: true });
    const providerMessageId = `spool_${record.id}`;
    const messagePath = join(this.spoolDir, `${record.id}.sms`);
    const content = [
      `To: ${record.to}`,
      `From: ${record.from}`,
      `X-AppointIt-Message-Id: ${record.id}`,
      record.vendorId ? `X-AppointIt-Vendor-Id: ${record.vendorId}` : undefined,
      record.appointmentId ? `X-AppointIt-Appointment-Id: ${record.appointmentId}` : undefined,
      "",
      record.message
    ]
      .filter((line) => line !== undefined)
      .join("\n");

    await atomicWriteFile(messagePath, content);
    return { providerMessageId };
  }
}
