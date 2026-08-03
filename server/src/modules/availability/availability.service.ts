import { addMinutes } from "date-fns";
import { AppointmentStatus, Prisma, PrismaClient } from "@prisma/client";
import { isInsideMinutesWindow, overlaps } from "./booking-rules.js";
import { zonedDateStorage, zonedDateTimeToUtc, zonedParts } from "../../utils/timezone.js";

type Db = PrismaClient | Prisma.TransactionClient;

export type AvailabilityRequest = {
  vendorId: string;
  branchId: string;
  serviceId: string;
  staffId?: string;
  startAt: Date;
  timezone?: string;
  excludeAppointmentId?: string;
};

function minutesSinceMidnight(date: Date, timezone: string, referenceDate?: Date) {
  const parts = zonedParts(date, timezone);
  if (!referenceDate) return parts.hour * 60 + parts.minute;
  const reference = zonedParts(referenceDate, timezone);
  const dayDifference = Math.round((Date.UTC(parts.year, parts.month - 1, parts.day) - Date.UTC(reference.year, reference.month - 1, reference.day)) / 86_400_000);
  return dayDifference * 1440 + parts.hour * 60 + parts.minute;
}

function parseTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export async function getQualifiedStaff(db: Db, vendorId: string, branchId: string, serviceId: string) {
  return db.staff.findMany({
    where: {
      vendorId,
      active: true,
      OR: [{ branchId }, { branchId: null }],
      services: { some: { serviceId } }
    },
    orderBy: { name: "asc" }
  });
}

export async function calculateAppointmentWindow(db: Db, vendorId: string, serviceId: string, startAt: Date) {
  const service = await db.service.findFirstOrThrow({ where: { id: serviceId, vendorId, active: true } });
  return {
    service,
    blockedStartAt: addMinutes(startAt, -service.bufferBeforeMinutes),
    endAt: addMinutes(startAt, service.durationMinutes),
    blockedEndAt: addMinutes(startAt, service.durationMinutes + service.bufferAfterMinutes)
  };
}

export async function assertStaffAvailable(db: Db, request: AvailabilityRequest & { staffId: string }) {
  const timezone = request.timezone ?? "UTC";
  const { service, blockedStartAt, endAt, blockedEndAt } = await calculateAppointmentWindow(
    db,
    request.vendorId,
    request.serviceId,
    request.startAt
  );

  const staff = await db.staff.findFirst({
    where: {
      id: request.staffId,
      vendorId: request.vendorId,
      active: true,
      OR: [{ branchId: request.branchId }, { branchId: null }],
      services: { some: { serviceId: request.serviceId } }
    }
  });
  if (!staff) throw new Error("Selected staff cannot perform this service");

  const weekday = zonedParts(request.startAt, timezone).weekday;
  const appointmentStartMinute = minutesSinceMidnight(request.startAt, timezone);
  const appointmentEndMinute = minutesSinceMidnight(endAt, timezone, request.startAt);
  const holidayDate = zonedDateStorage(request.startAt, timezone);

  const [vendorHours, branchHours, staffHours, holiday, breaks, existingAppointments] = await Promise.all([
    db.workingHour.findMany({ where: { vendorId: request.vendorId, branchId: null, staffId: null, weekday } }),
    db.workingHour.findMany({ where: { vendorId: request.vendorId, branchId: request.branchId, staffId: null, weekday } }),
    db.workingHour.findMany({ where: { vendorId: request.vendorId, staffId: request.staffId, weekday } }),
    db.holiday.findFirst({
      where: {
        vendorId: request.vendorId,
        date: holidayDate,
        OR: [
          { branchId: null, staffId: null },
          { branchId: request.branchId, staffId: null },
          { staffId: request.staffId }
        ]
      }
    }),
    db.breakTime.findMany({
      where: {
        vendorId: request.vendorId,
        weekday,
        OR: [
          { branchId: null, staffId: null },
          { branchId: request.branchId, staffId: null },
          { staffId: request.staffId }
        ]
      }
    }),
    db.appointment.findMany({
      where: {
        vendorId: request.vendorId,
        staffId: request.staffId,
        id: { not: request.excludeAppointmentId },
        status: { notIn: [AppointmentStatus.CANCELLED] },
        startAt: { lt: blockedEndAt },
        endAt: { gt: blockedStartAt }
      }
    })
  ]);

  const workingSet = staffHours.length > 0 ? staffHours : branchHours.length > 0 ? branchHours : vendorHours;
  const insideHours = workingSet.some((hour) => {
    return isInsideMinutesWindow(appointmentStartMinute, appointmentEndMinute, hour.startTime, hour.endTime);
  });

  if (!insideHours) throw new Error("Appointment is outside working hours");
  if (holiday) throw new Error("Selected date is unavailable");

  const hitsBreak = breaks.some((breakTime) => {
    const breakStart = parseTime(breakTime.startTime);
    const breakEnd = parseTime(breakTime.endTime);
    return appointmentStartMinute < breakEnd && breakStart < appointmentEndMinute;
  });
  if (hitsBreak) throw new Error("Appointment overlaps a break time");

  if (existingAppointments.some((appt) => overlaps({ start: blockedStartAt, end: blockedEndAt }, { start: appt.startAt, end: appt.endAt }))) {
    throw new Error("Selected time is already booked");
  }

  return { staff, service, endAt };
}

export async function findAvailableStaff(db: Db, request: AvailabilityRequest) {
  const timezone = request.timezone ?? (await db.vendor.findUniqueOrThrow({ where: { id: request.vendorId }, select: { timezone: true } })).timezone;
  if (request.staffId) {
    return assertStaffAvailable(db, { ...request, timezone, staffId: request.staffId });
  }
  const staff = await getQualifiedStaff(db, request.vendorId, request.branchId, request.serviceId);

  for (const candidate of staff) {
    try {
      return await assertStaffAvailable(db, { ...request, timezone, staffId: candidate.id });
    } catch {
      continue;
    }
  }

  throw new Error("No staff are available for the selected time");
}

export async function listAvailableSlots(
  db: Db,
  vendorId: string,
  branchId: string,
  serviceId: string,
  date: Date,
  staffId?: string
) {
  const [service, vendor] = await Promise.all([
    db.service.findFirstOrThrow({ where: { id: serviceId, vendorId, active: true } }),
    db.vendor.findUniqueOrThrow({ where: { id: vendorId }, select: { timezone: true } })
  ]);
  const slots: Array<{ startAt: Date; staffId: string }> = [];
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  for (let minute = 0; minute < 24 * 60; minute += 15) {
    const cursor = zonedDateTimeToUtc(year, month, day, Math.floor(minute / 60), minute % 60, vendor.timezone);
    if (cursor < new Date()) continue;
    try {
      const available = await findAvailableStaff(db, { vendorId, branchId, serviceId, staffId, startAt: cursor, timezone: vendor.timezone });
      slots.push({ startAt: cursor, staffId: available.staff.id });
    } catch {
      // Slot is unavailable; continue scanning.
    }
    if (slots.length >= Math.ceil((24 * 60) / Math.max(service.durationMinutes, 15))) break;
  }

  return slots;
}

export type AvailabilityDiagnosis = {
  date: string;
  timezone: string;
  qualifiedStaffCount: number;
  slots: Array<{ startAt: Date; staffId: string }>;
  reasons: Array<{ code: string; title: string; detail: string }>;
  staff: Array<{ id: string; name: string; availableSlots: number; blockers: string[] }>;
};

function addReason(reasons: AvailabilityDiagnosis["reasons"], code: string, title: string, detail: string) {
  if (!reasons.some((reason) => reason.code === code && reason.detail === detail)) reasons.push({ code, title, detail });
}

function readableAvailabilityError(error: unknown) {
  const message = error instanceof Error ? error.message : "This time is unavailable";
  if (message.includes("outside working hours")) return { code: "outside_hours", title: "Outside working hours", detail: "The selected service does not fit inside the vendor, branch, or staff working hours." };
  if (message.includes("unavailable")) return { code: "closed_date", title: "Closed date", detail: "A holiday or unavailable date is blocking this day." };
  if (message.includes("break time")) return { code: "break_conflict", title: "Break conflict", detail: "The appointment would overlap a configured break." };
  if (message.includes("already booked")) return { code: "appointment_conflict", title: "Already booked", detail: "An existing appointment or service buffer blocks this time." };
  if (message.includes("cannot perform")) return { code: "staff_not_qualified", title: "Staff not assigned", detail: "The selected staff member is not assigned to this service or branch." };
  return { code: "unavailable", title: "Unavailable", detail: message };
}

export async function diagnoseAvailability(
  db: Db,
  vendorId: string,
  branchId: string,
  serviceId: string,
  date: Date,
  staffId?: string
): Promise<AvailabilityDiagnosis> {
  const [service, vendor, branch, requestedStaff] = await Promise.all([
    db.service.findFirst({ where: { id: serviceId, vendorId, active: true } }),
    db.vendor.findUniqueOrThrow({ where: { id: vendorId }, select: { timezone: true } }),
    db.branch.findFirst({ where: { id: branchId, vendorId, active: true }, select: { id: true, name: true } }),
    staffId ? db.staff.findFirst({ where: { id: staffId, vendorId, active: true }, select: { id: true, name: true } }) : Promise.resolve(null)
  ]);

  const reasons: AvailabilityDiagnosis["reasons"] = [];
  if (!branch) addReason(reasons, "branch_inactive", "Branch unavailable", "Choose an active branch for this booking.");
  if (!service) addReason(reasons, "service_inactive", "Service unavailable", "Choose an active service before checking slots.");
  if (staffId && !requestedStaff) addReason(reasons, "staff_inactive", "Staff unavailable", "The selected staff member is inactive or does not exist.");

  if (!branch || !service || (staffId && !requestedStaff)) {
    return { date: date.toISOString().slice(0, 10), timezone: vendor.timezone, qualifiedStaffCount: 0, slots: [], reasons, staff: [] };
  }

  const candidates = staffId ? await getQualifiedStaff(db, vendorId, branchId, serviceId).then((items) => items.filter((item) => item.id === staffId)) : await getQualifiedStaff(db, vendorId, branchId, serviceId);
  if (candidates.length === 0) addReason(reasons, "no_qualified_staff", "No matching provider", "No active staff member is assigned to this service at the selected branch.");

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const weekday = zonedParts(zonedDateTimeToUtc(year, month, day, 12, 0, vendor.timezone), vendor.timezone).weekday;
  const [vendorHours, branchHours, staffHours, holidays] = await Promise.all([
    db.workingHour.findMany({ where: { vendorId, branchId: null, staffId: null, weekday } }),
    db.workingHour.findMany({ where: { vendorId, branchId, staffId: null, weekday } }),
    db.workingHour.findMany({ where: { vendorId, staffId: { in: candidates.map((staff) => staff.id) }, weekday } }),
    db.holiday.findMany({
      where: {
        vendorId,
        date: zonedDateStorage(zonedDateTimeToUtc(year, month, day, 12, 0, vendor.timezone), vendor.timezone),
        OR: [{ branchId: null, staffId: null }, { branchId, staffId: null }, { staffId: { in: candidates.map((staff) => staff.id) } }]
      }
    })
  ]);

  if (vendorHours.length === 0 && branchHours.length === 0 && staffHours.length === 0) {
    addReason(reasons, "no_working_hours", "No opening hours", "There are no vendor, branch, or staff working hours configured for this weekday.");
  }
  const globalHoliday = holidays.find((holiday) => !holiday.branchId && !holiday.staffId);
  const branchHoliday = holidays.find((holiday) => holiday.branchId === branchId && !holiday.staffId);
  if (globalHoliday || branchHoliday) {
    addReason(reasons, "closed_date", "Closed date", (globalHoliday ?? branchHoliday)?.reason ?? "This date is marked as unavailable.");
  }

  const staffSummaries: AvailabilityDiagnosis["staff"] = [];
  const slots: AvailabilityDiagnosis["slots"] = [];
  const slotLimit = Math.ceil((24 * 60) / Math.max(service.durationMinutes, 15));

  for (const candidate of candidates) {
    const blockers = new Map<string, string>();
    let availableSlots = 0;
    for (let minute = 0; minute < 24 * 60; minute += 15) {
      const cursor = zonedDateTimeToUtc(year, month, day, Math.floor(minute / 60), minute % 60, vendor.timezone);
      if (cursor < new Date()) continue;
      try {
        await assertStaffAvailable(db, { vendorId, branchId, serviceId, staffId: candidate.id, startAt: cursor, timezone: vendor.timezone });
        availableSlots += 1;
        if (slots.length < slotLimit) slots.push({ startAt: cursor, staffId: candidate.id });
      } catch (error) {
        const reason = readableAvailabilityError(error);
        blockers.set(reason.code, reason.title);
        addReason(reasons, reason.code, reason.title, reason.detail);
      }
    }
    staffSummaries.push({ id: candidate.id, name: candidate.name, availableSlots, blockers: [...blockers.values()] });
  }

  slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return {
    date: date.toISOString().slice(0, 10),
    timezone: vendor.timezone,
    qualifiedStaffCount: candidates.length,
    slots: slots.slice(0, slotLimit),
    reasons: slots.length > 0 ? [] : reasons,
    staff: staffSummaries
  };
}
