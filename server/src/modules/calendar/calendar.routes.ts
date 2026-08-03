import { Router } from "express";
import { createEvent } from "ics";
import { prisma } from "../../db.js";
import { requireAuth } from "../../middleware/auth.js";

export const calendarRouter = Router();

calendarRouter.use(requireAuth);

calendarRouter.get("/ics/:appointmentId", async (req, res) => {
  const vendorId = req.user?.vendorId;
  const appointment = await prisma.appointment.findFirst({
    where: req.user?.role === "SUPER_ADMIN" ? { id: req.params.appointmentId } : { id: req.params.appointmentId, vendorId: vendorId ?? "" },
    include: { service: true, customer: true, branch: true }
  });
  if (!appointment) return res.status(404).json({ error: "Appointment not found" });

  const start: [number, number, number, number, number] = [
    appointment.startAt.getUTCFullYear(),
    appointment.startAt.getUTCMonth() + 1,
    appointment.startAt.getUTCDate(),
    appointment.startAt.getUTCHours(),
    appointment.startAt.getUTCMinutes()
  ];

  createEvent({
    start,
    startInputType: "utc",
    duration: { minutes: Math.round((appointment.endAt.getTime() - appointment.startAt.getTime()) / 60000) },
    title: `${appointment.service.name} - ${appointment.customer.name}`,
    location: appointment.branch.address,
    status: appointment.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED"
  }, (error, value) => {
    if (error) return res.status(500).json({ error: "Could not generate ICS" });
    res.header("content-type", "text/calendar");
    return res.send(value);
  });
});
