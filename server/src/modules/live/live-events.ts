import type { Response } from "express";

export type LiveResource = "appointments" | "customers" | "staff" | "services" | "branches" | "availability" | "vendor" | "notifications" | "activity" | "calendar" | "billing" | "users" | "plans" | "logs";

type Client = { response: Response; heartbeat: NodeJS.Timeout };
const clients = new Map<string, Set<Client>>();

export function addLiveClient(scope: string, response: Response) {
  response.write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ connected: true, at: new Date().toISOString() })}\n\n`);
  const client: Client = {
    response,
    heartbeat: setInterval(() => {
      if (!response.destroyed && !response.writableEnded) response.write(`: keep-alive ${Date.now()}\n\n`);
    }, 15_000)
  };
  const scoped = clients.get(scope) ?? new Set<Client>();
  scoped.add(client);
  clients.set(scope, scoped);
  return () => {
    clearInterval(client.heartbeat);
    scoped.delete(client);
    if (scoped.size === 0) clients.delete(scope);
  };
}

export function publishLiveEvent(scope: string | null | undefined, resources: LiveResource[]) {
  if (!scope || resources.length === 0) return;
  const payload = `event: change\ndata: ${JSON.stringify({ resources: [...new Set(resources)], at: new Date().toISOString() })}\n\n`;
  for (const client of clients.get(scope) ?? []) {
    if (!client.response.destroyed && !client.response.writableEnded) client.response.write(payload);
  }
  if (scope !== "platform") for (const client of clients.get("platform") ?? []) {
    if (!client.response.destroyed && !client.response.writableEnded) client.response.write(payload);
  }
}
