CREATE TYPE "PhoneChallengePurpose" AS ENUM ('PHONE_VERIFICATION', 'LOGIN_2FA');

ALTER TABLE "User"
ADD COLUMN "smsTwoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PhoneVerificationSession"
ADD COLUMN "purpose" "PhoneChallengePurpose" NOT NULL DEFAULT 'PHONE_VERIFICATION';
