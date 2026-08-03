import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type SmsGatewayConfig } from "../src/config.js";
import { createSmsGatewayServer } from "../src/server.js";

const temporaryDirs: string[] = [];

function createConfig(dir: string, provider: "mock" | "spool" = "mock"): SmsGatewayConfig {
  return {
    port: 0,
    apiKey: "test-key",
    provider,
    spoolDir: join(dir, "outbox"),
    logFile: join(dir, "messages.jsonl"),
    maxBodyBytes: 4096,
    rateLimitPerMinute: 50,
    defaultFrom: "AppointIt"
  };
}

async function createTemporaryDir() {
  const dir = await mkdtemp(join(tmpdir(), "appointit-sms-gateway-"));
  temporaryDirs.push(dir);
  return dir;
}

async function withServer<T>(config: SmsGatewayConfig, callback: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createSmsGatewayServer({ config });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Could not resolve test server address.");
  }

  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("sms gateway", () => {
  it("rejects unauthenticated send attempts", async () => {
    const dir = await createTemporaryDir();
    await withServer(createConfig(dir), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/send-sms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "+251911000001", message: "Reminder" })
      });

      expect(response.status).toBe(401);
    });
  });

  it("accepts and logs messages through the mock provider", async () => {
    const dir = await createTemporaryDir();
    await withServer(createConfig(dir), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/send-sms`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json"
        },
        body: JSON.stringify({ to: "+251911000001", message: "Appointment confirmed", vendorId: "vendor-1" })
      });

      expect(response.status).toBe(202);
      const body = (await response.json()) as { id: string; status: string };
      expect(body.status).toBe("sent");

      const log = await readFile(join(dir, "messages.jsonl"), "utf8");
      expect(log).toContain(body.id);
      expect(log).toContain("Appointment confirmed");
    });
  });

  it("writes spool files for modem-backed sending", async () => {
    const dir = await createTemporaryDir();
    await withServer(createConfig(dir, "spool"), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/send-sms`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json"
        },
        body: JSON.stringify({ to: "+251911000001", from: "Clinic", message: "See you at 10:00" })
      });

      expect(response.status).toBe(202);
      const files = await readdir(join(dir, "outbox"));
      expect(files).toHaveLength(1);

      const spoolContent = await readFile(join(dir, "outbox", files[0]), "utf8");
      expect(spoolContent).toContain("To: +251911000001");
      expect(spoolContent).toContain("From: Clinic");
      expect(spoolContent).toContain("See you at 10:00");
    });
  });
});
