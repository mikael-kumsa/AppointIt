import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogStatus } from "@prisma/client";

vi.mock("../src/db.js", () => ({
  prisma: {
    notificationLog: { findFirst: vi.fn(), update: vi.fn() },
    webhookLog: { create: vi.fn() },
    messageSetting: { findUnique: vi.fn() },
    appointment: { findMany: vi.fn() }
  }
}));

import { prisma } from "../src/db.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", "postgresql://appointit:appointit@localhost:5433/appointit?schema=public");
  vi.stubEnv("AFROMESSAGE_CALLBACK_SECRET", "test-callback-secret");
});

describe("AfroMessage delivery callback", () => {
  it("updates the tenant notification log for an authenticated callback", async () => {
    vi.mocked(prisma.notificationLog.findFirst).mockResolvedValue({ id: "log-1", vendorId: "vendor-1" } as any);
    const { webhooksRouter } = await import("../src/modules/webhooks/webhooks.routes.js");
    const app = express();
    app.use("/api/webhooks", webhooksRouter);

    const response = await request(app).get("/api/webhooks/afromessage/status")
      .query({ secret: "test-callback-secret", message_id: "message-1", status: "Delivered" });

    expect(response.status).toBe(200);
    expect(prisma.notificationLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { status: LogStatus.DELIVERED }
    });
    expect(prisma.webhookLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ vendorId: "vendor-1", provider: "afromessage", eventType: "delivery_status" })
    });
  });

  it("rejects callbacks with the wrong secret", async () => {
    const { webhooksRouter } = await import("../src/modules/webhooks/webhooks.routes.js");
    const app = express();
    app.use("/api/webhooks", webhooksRouter);

    const response = await request(app).get("/api/webhooks/afromessage/status")
      .query({ secret: "wrong", message_id: "message-1", status: "Delivered" });

    expect(response.status).toBe(401);
    expect(prisma.notificationLog.update).not.toHaveBeenCalled();
  });
});
