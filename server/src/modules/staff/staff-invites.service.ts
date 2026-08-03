import crypto from "node:crypto";
import { UserRole } from "@prisma/client";
import { prisma } from "../../db.js";
import { env } from "../../config/env.js";
import { hashPassword } from "../auth/auth.service.js";
import { sendPlatformEmail } from "../notifications/email.service.js";

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function inviteUrl(token: string) {
  return `${env.APP_ORIGIN}/accept-invite?token=${encodeURIComponent(token)}`;
}

export async function createStaffInvite(input: {
  vendorId: string;
  staffId?: string;
  email: string;
  name: string;
  phone?: string;
  role: "RECEPTIONIST" | "STAFF";
}) {
  if (input.role === UserRole.STAFF && !input.staffId) {
    throw new Error("Staff role invites must be linked to a staff profile.");
  }
  if (input.staffId) {
    const staff = await prisma.staff.findFirst({ where: { id: input.staffId, vendorId: input.vendorId } });
    if (!staff) throw new Error("Staff profile not found for this vendor.");
  }
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) throw new Error("A user with this email already exists.");

  const token = crypto.randomBytes(32).toString("base64url");
  const invite = await prisma.staffInvite.create({
    data: {
      vendorId: input.vendorId,
      staffId: input.staffId,
      email: input.email,
      name: input.name,
      phone: input.phone,
      role: input.role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  });
  return { invite, token, inviteUrl: inviteUrl(token) };
}

export async function renewStaffInvite(vendorId: string, inviteId: string) {
  const existing = await prisma.staffInvite.findFirst({ where: { id: inviteId, vendorId, acceptedAt: null } });
  if (!existing) throw new Error("Pending invitation not found.");
  const token = crypto.randomBytes(32).toString("base64url");
  const invite = await prisma.staffInvite.update({ where: { id: existing.id }, data: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
  return { invite, token, inviteUrl: inviteUrl(token) };
}

export async function sendStaffInviteEmail(invite: { email: string; name: string }, url: string) {
  return sendPlatformEmail({
    to: invite.email,
    subject: "You are invited to AppointIt",
    text: `Hello ${invite.name},\n\nYou have been invited to join an AppointIt workspace.\n\nAccept invitation: ${url}\n\nThis link expires in 7 days.`
  });
}

export async function acceptStaffInvite(token: string, password: string) {
  const tokenHash = hashToken(token);
  const invite = await prisma.staffInvite.findUnique({ where: { tokenHash } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    throw new Error("Invite link is invalid or expired.");
  }
  const existingUser = await prisma.user.findUnique({ where: { email: invite.email } });
  if (existingUser) throw new Error("A user with this email already exists.");

  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        vendorId: invite.vendorId,
        staffId: invite.staffId,
        name: invite.name,
        email: invite.email,
        phone: invite.phone,
        passwordHash,
        role: invite.role,
        active: true
      }
    });
    await tx.staffInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date(), acceptedUserId: user.id }
    });
    await tx.auditLog.create({
      data: {
        vendorId: invite.vendorId,
        actorUserId: user.id,
        action: "staff_invite_accepted",
        entityType: "User",
        entityId: user.id,
        metadata: { role: invite.role, email: invite.email }
      }
    });
    return user;
  });
}
