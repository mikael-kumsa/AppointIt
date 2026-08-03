import { PlanVersionStatus, PrismaClient, SubscriptionStatus, UserRole, VendorStatus } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/auth.service.js";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword("Password123!");

  await prisma.user.upsert({
    where: { email: "super@appointit.local" },
    update: {},
    create: {
      name: "Platform Admin",
      email: "super@appointit.local",
      passwordHash,
      role: UserRole.SUPER_ADMIN
    }
  });

  const vendor = await prisma.vendor.upsert({
    where: { slug: "addis-dental-clinic" },
    update: {},
    create: {
      name: "Addis Dental Clinic",
      slug: "addis-dental-clinic",
      businessType: "Dental clinic",
      phone: "+251900000000",
      email: "hello@addisdental.local",
      phoneVerifiedAt: new Date(),
      telegramVerifiedAt: new Date(),
      status: VendorStatus.ACTIVE
    }
  });

  const standardVersion = await prisma.planVersion.findFirstOrThrow({
    where: { plan: { code: "STANDARD" }, status: PlanVersionStatus.PUBLISHED },
    orderBy: { version: "desc" }
  });
  await prisma.vendorSubscription.upsert({
    where: { vendorId: vendor.id },
    update: {},
    create: { vendorId: vendor.id, planVersionId: standardVersion.id, status: SubscriptionStatus.ACTIVE, provider: "manual" }
  });

  await prisma.user.upsert({
    where: { email: "admin@addisdental.local" },
    update: {},
    create: {
      vendorId: vendor.id,
      name: "Clinic Admin",
      email: "admin@addisdental.local",
      phone: "+251900000000",
      phoneVerifiedAt: new Date(),
      telegramVerifiedAt: new Date(),
      passwordHash,
      role: UserRole.VENDOR_ADMIN
    }
  });

  const branch = await prisma.branch.upsert({
    where: { id: "seed-main-branch" },
    update: {},
    create: {
      id: "seed-main-branch",
      vendorId: vendor.id,
      name: "Bole Main Branch",
      address: "Bole, Addis Ababa",
      phone: "+251911111111"
    }
  });

  const cleaning = await prisma.service.upsert({
    where: { id: "seed-cleaning" },
    update: {},
    create: {
      id: "seed-cleaning",
      vendorId: vendor.id,
      name: "Dental Cleaning",
      description: "Routine cleaning and polishing",
      category: "Dental care",
      priceCents: 250000,
      durationMinutes: 45,
      bufferAfterMinutes: 10
    }
  });

  const staff = await prisma.staff.upsert({
    where: { id: "seed-dr-hana" },
    update: {},
    create: {
      id: "seed-dr-hana",
      vendorId: vendor.id,
      branchId: branch.id,
      name: "Dr. Hana Tesfaye",
      roleTitle: "Dentist",
      phone: "+251922222222",
      email: "hana@addisdental.local",
      services: { create: { serviceId: cleaning.id } }
    }
  });

  for (const weekday of [1, 2, 3, 4, 5, 6]) {
    await prisma.workingHour.upsert({
      where: { id: `seed-vendor-hours-${weekday}` },
      update: {},
      create: {
        id: `seed-vendor-hours-${weekday}`,
        vendorId: vendor.id,
        weekday,
        startTime: "08:00",
        endTime: "18:00"
      }
    });
    await prisma.workingHour.upsert({
      where: { id: `seed-staff-hours-${weekday}` },
      update: {},
      create: {
        id: `seed-staff-hours-${weekday}`,
        vendorId: vendor.id,
        staffId: staff.id,
        weekday,
        startTime: "09:00",
        endTime: "17:00"
      }
    });
  }

  await prisma.breakTime.upsert({
    where: { id: "seed-lunch-break" },
    update: {},
    create: {
      id: "seed-lunch-break",
      vendorId: vendor.id,
      staffId: staff.id,
      weekday: 1,
      startTime: "12:00",
      endTime: "13:00"
    }
  });

  console.log("Seed complete");
}

main().finally(async () => prisma.$disconnect());
