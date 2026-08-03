CREATE TYPE "PlanVersionStatus" AS ENUM ('PUBLISHED', 'ARCHIVED');
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanVersion" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PlanVersionStatus" NOT NULL DEFAULT 'PUBLISHED',
    "currency" TEXT NOT NULL DEFAULT 'ETB',
    "monthlyPriceCents" INTEGER,
    "annualPriceCents" INTEGER,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanEntitlement" (
    "id" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    CONSTRAINT "PlanEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VendorSubscription" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VendorSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");
CREATE INDEX "SubscriptionPlan_active_isPublic_displayOrder_idx" ON "SubscriptionPlan"("active", "isPublic", "displayOrder");
CREATE UNIQUE INDEX "PlanVersion_planId_version_key" ON "PlanVersion"("planId", "version");
CREATE INDEX "PlanVersion_planId_status_idx" ON "PlanVersion"("planId", "status");
CREATE UNIQUE INDEX "PlanEntitlement_planVersionId_key_key" ON "PlanEntitlement"("planVersionId", "key");
CREATE INDEX "PlanEntitlement_key_idx" ON "PlanEntitlement"("key");
CREATE UNIQUE INDEX "VendorSubscription_vendorId_key" ON "VendorSubscription"("vendorId");
CREATE INDEX "VendorSubscription_planVersionId_status_idx" ON "VendorSubscription"("planVersionId", "status");

ALTER TABLE "PlanVersion" ADD CONSTRAINT "PlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanEntitlement" ADD CONSTRAINT "PlanEntitlement_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VendorSubscription" ADD CONSTRAINT "VendorSubscription_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VendorSubscription" ADD CONSTRAINT "VendorSubscription_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "SubscriptionPlan" ("id", "code", "name", "description", "displayOrder", "active", "isPublic", "updatedAt") VALUES
('plan_standard', 'STANDARD', 'Standard', 'Core appointment management for a single-location service business.', 1, true, true, CURRENT_TIMESTAMP),
('plan_premium', 'PREMIUM', 'Premium', 'Multi-location operations, custom branding, and advanced reporting.', 2, true, true, CURRENT_TIMESTAMP),
('plan_enterprise', 'ENTERPRISE', 'Enterprise', 'Configurable scale, integrations, and guided rollout for complex organizations.', 3, true, true, CURRENT_TIMESTAMP);

INSERT INTO "PlanVersion" ("id", "planId", "version", "status", "currency", "monthlyPriceCents", "annualPriceCents", "trialDays") VALUES
('plan_standard_v1', 'plan_standard', 1, 'PUBLISHED', 'ETB', 100000, 1000000, 0),
('plan_premium_v1', 'plan_premium', 1, 'PUBLISHED', 'ETB', 250000, 2500000, 0),
('plan_enterprise_v1', 'plan_enterprise', 1, 'PUBLISHED', 'ETB', NULL, NULL, 0);

INSERT INTO "PlanEntitlement" ("id", "planVersionId", "key", "value") VALUES
('ent_standard_max_branches', 'plan_standard_v1', 'maxBranches', '1'),
('ent_standard_max_staff', 'plan_standard_v1', 'maxStaff', '5'),
('ent_standard_custom_domain', 'plan_standard_v1', 'customDomain', 'false'),
('ent_standard_calendar', 'plan_standard_v1', 'calendarSync', 'true'),
('ent_standard_sms', 'plan_standard_v1', 'smsAutomation', 'true'),
('ent_standard_reports', 'plan_standard_v1', 'advancedReports', 'false'),
('ent_standard_audit', 'plan_standard_v1', 'auditRetentionDays', '30'),
('ent_standard_support', 'plan_standard_v1', 'prioritySupport', 'false'),
('ent_standard_integrations', 'plan_standard_v1', 'customIntegrations', 'false'),
('ent_premium_max_branches', 'plan_premium_v1', 'maxBranches', '5'),
('ent_premium_max_staff', 'plan_premium_v1', 'maxStaff', '25'),
('ent_premium_custom_domain', 'plan_premium_v1', 'customDomain', 'true'),
('ent_premium_calendar', 'plan_premium_v1', 'calendarSync', 'true'),
('ent_premium_sms', 'plan_premium_v1', 'smsAutomation', 'true'),
('ent_premium_reports', 'plan_premium_v1', 'advancedReports', 'true'),
('ent_premium_audit', 'plan_premium_v1', 'auditRetentionDays', '365'),
('ent_premium_support', 'plan_premium_v1', 'prioritySupport', 'true'),
('ent_premium_integrations', 'plan_premium_v1', 'customIntegrations', 'false'),
('ent_enterprise_max_branches', 'plan_enterprise_v1', 'maxBranches', '-1'),
('ent_enterprise_max_staff', 'plan_enterprise_v1', 'maxStaff', '-1'),
('ent_enterprise_custom_domain', 'plan_enterprise_v1', 'customDomain', 'true'),
('ent_enterprise_calendar', 'plan_enterprise_v1', 'calendarSync', 'true'),
('ent_enterprise_sms', 'plan_enterprise_v1', 'smsAutomation', 'true'),
('ent_enterprise_reports', 'plan_enterprise_v1', 'advancedReports', 'true'),
('ent_enterprise_audit', 'plan_enterprise_v1', 'auditRetentionDays', '2555'),
('ent_enterprise_support', 'plan_enterprise_v1', 'prioritySupport', 'true'),
('ent_enterprise_integrations', 'plan_enterprise_v1', 'customIntegrations', 'true');

INSERT INTO "VendorSubscription" ("id", "vendorId", "planVersionId", "status", "provider", "currentPeriodStart", "updatedAt")
SELECT CONCAT('sub_', MD5("id")), "id",
       CASE WHEN "plan" = 'CUSTOM_DOMAIN' THEN 'plan_premium_v1' ELSE 'plan_standard_v1' END,
       'ACTIVE', 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Vendor";

ALTER TABLE "Vendor" DROP COLUMN "plan";
DROP TYPE "VendorPlan";
