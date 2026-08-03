import { AppointmentStatus } from "@prisma/client";

const activeStatuses: AppointmentStatus[] = [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, AppointmentStatus.RESCHEDULED];

export function assertAppointmentTransition(current: AppointmentStatus, next: AppointmentStatus, startAt: Date, now = new Date()) {
  if (!activeStatuses.includes(current)) throw new Error(`A ${current.toLowerCase().replace("_", "-")} appointment cannot be changed to ${next.toLowerCase().replace("_", "-")}`);
  const afterStartStatuses: AppointmentStatus[] = [AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW];
  if (afterStartStatuses.includes(next) && startAt > now) {
    throw new Error(`${next === AppointmentStatus.COMPLETED ? "Completion" : "No-show"} can only be recorded after the appointment starts`);
  }
}

export function isActiveAppointmentStatus(status: AppointmentStatus) {
  return activeStatuses.includes(status);
}
