import jwt from "jsonwebtoken";
import { CalendarConnection, LogStatus } from "@prisma/client";
import { prisma } from "../../db.js";
import { env } from "../../config/env.js";
import { decryptSecret, encryptSecret } from "../../utils/crypto.js";
import { requireActiveVendorEntitlements } from "../plans/plans.service.js";
import { publishLiveEvent } from "../live/live-events.js";

const googleAuthUrl = "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenUrl = "https://oauth2.googleapis.com/token";
const calendarBaseUrl = "https://www.googleapis.com/calendar/v3";
const calendarScope = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const provider = "google";

type GoogleState = {
  userId: string;
  vendorId: string;
  staffId?: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type AppointmentForCalendar = Awaited<ReturnType<typeof loadAppointmentForCalendar>>;

export function googleRedirectUri() {
  return env.GOOGLE_REDIRECT_URI || new URL("/api/calendar/google/callback", env.APP_ORIGIN).toString();
}

function configured() {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function ensureConfigured() {
  if (!configured()) throw new Error("Google Calendar OAuth is not configured");
}

function authHeader(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}

function tokenExpiresAt(expiresIn?: number) {
  return expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined;
}

function makeState(input: GoogleState) {
  return jwt.sign(input, env.JWT_ACCESS_SECRET, { expiresIn: "10m" });
}

export function verifyGoogleState(state: string) {
  return jwt.verify(state, env.JWT_ACCESS_SECRET) as GoogleState;
}

export function buildGoogleConnectUrl(input: GoogleState) {
  ensureConfigured();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: calendarScope,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: makeState(input)
  });
  return `${googleAuthUrl}?${params.toString()}`;
}

async function requestToken(body: URLSearchParams) {
  const response = await fetch(googleTokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = await response.json() as GoogleTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Google token request failed");
  }
  return payload;
}

export async function completeGoogleOAuth(code: string, state: string) {
  ensureConfigured();
  const parsed = verifyGoogleState(state);
  const plan = await requireActiveVendorEntitlements(parsed.vendorId);
  if (!plan.entitlements.calendarSync) throw new Error("Google Calendar sync is not included in the current subscription");
  const token = await requestToken(new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID!,
    client_secret: env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code"
  }));

  const existing = await prisma.calendarConnection.findFirst({
    where: { vendorId: parsed.vendorId, staffId: parsed.staffId ?? null, provider }
  });

  const data = {
    provider,
    encryptedAccessToken: encryptSecret(token.access_token!),
    encryptedRefreshToken: token.refresh_token ? encryptSecret(token.refresh_token) : existing?.encryptedRefreshToken,
    expiresAt: tokenExpiresAt(token.expires_in),
    syncEnabled: true
  };

  if (existing) {
    const connection = await prisma.calendarConnection.update({ where: { id: existing.id }, data });
    publishLiveEvent(parsed.vendorId, ["calendar", "vendor"]);
    return connection;
  }

  const connection = await prisma.calendarConnection.create({
    data: {
      vendorId: parsed.vendorId,
      staffId: parsed.staffId,
      ...data
    }
  });
  publishLiveEvent(parsed.vendorId, ["calendar", "vendor"]);
  return connection;
}

async function refreshConnection(connection: CalendarConnection) {
  if (!connection.encryptedRefreshToken) return connection;
  const token = await requestToken(new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    client_secret: env.GOOGLE_CLIENT_SECRET!,
    refresh_token: decryptSecret(connection.encryptedRefreshToken),
    grant_type: "refresh_token"
  }));
  return prisma.calendarConnection.update({
    where: { id: connection.id },
    data: {
      encryptedAccessToken: encryptSecret(token.access_token!),
      expiresAt: tokenExpiresAt(token.expires_in)
    }
  });
}

async function getConnection(vendorId: string, staffId?: string) {
  const where = {
    vendorId,
    provider,
    syncEnabled: true,
    ...(staffId ? { OR: [{ staffId }, { staffId: null }] } : { staffId: null })
  };
  let connection = await prisma.calendarConnection.findFirst({
    where,
    orderBy: { staffId: "desc" }
  });
  if (!connection) return null;
  if (connection.expiresAt && connection.expiresAt.getTime() - Date.now() < 60_000) {
    connection = await refreshConnection(connection);
  }
  return connection;
}

async function loadAppointmentForCalendar(appointmentId: string) {
  return prisma.appointment.findUniqueOrThrow({
    where: { id: appointmentId },
    include: {
      vendor: true,
      branch: true,
      customer: true,
      service: true,
      staff: true
    }
  });
}

function googleEventBody(appointment: AppointmentForCalendar) {
  return {
    summary: `${appointment.service.name} - ${appointment.customer.name}`,
    description: [
      `Customer: ${appointment.customer.name}`,
      `Phone: ${appointment.customer.phone}`,
      appointment.customer.email ? `Email: ${appointment.customer.email}` : null,
      `Service: ${appointment.service.name}`,
      `Provider: ${appointment.staff.name}`,
      appointment.notes ? `Notes: ${appointment.notes}` : null
    ].filter(Boolean).join("\n"),
    location: appointment.branch.address,
    start: {
      dateTime: appointment.startAt.toISOString(),
      timeZone: appointment.vendor.timezone
    },
    end: {
      dateTime: appointment.endAt.toISOString(),
      timeZone: appointment.vendor.timezone
    },
    extendedProperties: {
      private: {
        appointitAppointmentId: appointment.id,
        appointitVendorId: appointment.vendorId
      }
    }
  };
}

async function calendarRequest<T>(connection: CalendarConnection, path: string, init: RequestInit) {
  const response = await fetch(`${calendarBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...authHeader(decryptSecret(connection.encryptedAccessToken)),
      ...init.headers
    }
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || "Google Calendar request failed");
  return payload;
}

async function logCalendar(appointment: AppointmentForCalendar, action: string, status: LogStatus, errorMessage?: string) {
  await prisma.calendarSyncLog.create({
    data: {
      vendorId: appointment.vendorId,
      appointmentId: appointment.id,
      provider,
      action,
      status,
      errorMessage
    }
  });
}

export async function syncAppointmentToGoogle(appointmentId: string, action: "create" | "update" | "cancel") {
  const appointment = await loadAppointmentForCalendar(appointmentId);
  const connection = await getConnection(appointment.vendorId, appointment.staffId);
  if (!connection) return;

  try {
    const targetCalendarId = connection.calendarId || "primary";
    if (action === "cancel") {
      if (appointment.googleCalendarEventId) {
        await calendarRequest<void>(connection, `/calendars/${encodeURIComponent(targetCalendarId)}/events/${encodeURIComponent(appointment.googleCalendarEventId)}`, { method: "DELETE" });
      }
    await logCalendar(appointment, "delete_event", LogStatus.SENT);
      publishLiveEvent(appointment.vendorId, ["calendar"]);
      return;
    }

    if (appointment.googleCalendarEventId) {
      await calendarRequest(connection, `/calendars/${encodeURIComponent(targetCalendarId)}/events/${encodeURIComponent(appointment.googleCalendarEventId)}`, {
        method: "PATCH",
        body: JSON.stringify(googleEventBody(appointment))
      });
      await logCalendar(appointment, "update_event", LogStatus.SENT);
      publishLiveEvent(appointment.vendorId, ["calendar"]);
      return;
    }

    const event = await calendarRequest<{ id: string }>(connection, `/calendars/${encodeURIComponent(targetCalendarId)}/events?sendUpdates=none`, {
      method: "POST",
      body: JSON.stringify(googleEventBody(appointment))
    });
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { googleCalendarEventId: event.id }
    });
    await logCalendar(appointment, "create_event", LogStatus.SENT);
    publishLiveEvent(appointment.vendorId, ["calendar"]);
  } catch (error) {
    await logCalendar(appointment, action === "cancel" ? "delete_event" : appointment.googleCalendarEventId ? "update_event" : "create_event", LogStatus.FAILED, error instanceof Error ? error.message : "Google Calendar sync failed");
    publishLiveEvent(appointment.vendorId, ["calendar"]);
  }
}

export async function getGoogleCalendarStatus(vendorId: string) {
  const [connections, logs, plan] = await Promise.all([
    prisma.calendarConnection.findMany({ where: { vendorId, provider }, select: { id: true, staffId: true, calendarId: true, syncEnabled: true, expiresAt: true, createdAt: true, staff: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.calendarSyncLog.findMany({ where: { vendorId }, select: { id: true, appointmentId: true, action: true, status: true, errorMessage: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 20 }),
    requireActiveVendorEntitlements(vendorId).catch(() => null)
  ]);
  const connection = connections.find((item) => item.staffId === null);
  return {
    configured: configured(),
    redirectUri: googleRedirectUri(),
    scopes: calendarScope.split(" "),
    connected: Boolean(connection),
    syncEnabled: connection?.syncEnabled ?? false,
    expiresAt: connection?.expiresAt ?? null,
    canUseCalendarSync: Boolean(plan?.entitlements.calendarSync),
    connections,
    logs
  };
}

export async function listGoogleCalendars(vendorId: string, connectionId: string) {
  let connection = await prisma.calendarConnection.findFirst({ where: { id: connectionId, vendorId, provider } });
  if (!connection) throw new Error("Calendar connection not found");
  if (connection.expiresAt && connection.expiresAt.getTime() - Date.now() < 60_000) connection = await refreshConnection(connection);
  const result = await calendarRequest<{ items?: Array<{ id: string; summary: string; primary?: boolean; accessRole?: string }> }>(connection, "/users/me/calendarList", { method: "GET" });
  return (result.items ?? []).filter((item) => ["owner", "writer"].includes(item.accessRole ?? "")).map((item) => ({ id: item.id, name: item.summary, primary: Boolean(item.primary) }));
}
