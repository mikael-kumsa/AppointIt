import { prisma } from "../../db.js";
import { publishLiveEvent } from "../live/live-events.js";

export type AppointmentActivityType = "new_booking" | "appointment_rescheduled" | "appointment_cancelled" | "appointment_completed" | "appointment_no_show";

const titles: Record<AppointmentActivityType, string> = {
  new_booking: "New booking",
  appointment_rescheduled: "Appointment rescheduled",
  appointment_cancelled: "Appointment cancelled",
  appointment_completed: "Appointment completed",
  appointment_no_show: "Appointment marked no-show"
};

export async function recordAppointmentActivity(appointmentId: string, type: AppointmentActivityType) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { customer: { select: { name: true } }, service: { select: { name: true } }, vendor: { select: { timezone: true } } }
  });
  if (!appointment) return null;
  const when = new Intl.DateTimeFormat("en", {
    timeZone: appointment.vendor.timezone,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(appointment.startAt);
  const notification = await prisma.activityNotification.create({
    data: {
      vendorId: appointment.vendorId,
      appointmentId: appointment.id,
      type,
      title: titles[type],
      message: `${appointment.customer.name} · ${appointment.service.name} · ${when}`
    }
  });
  publishLiveEvent(appointment.vendorId, ["activity"]);
  return notification;
}
