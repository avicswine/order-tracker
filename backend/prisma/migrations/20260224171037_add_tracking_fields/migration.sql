-- CreateEnum
CREATE TYPE "TrackingSystem" AS ENUM ('SSW', 'SENIOR', 'NONE');

-- AlterTable
ALTER TABLE "carriers" ADD COLUMN     "trackingIdentifier" TEXT,
ADD COLUMN     "trackingSystem" "TrackingSystem" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "lastTracking" TEXT,
ADD COLUMN     "lastTrackingAt" TIMESTAMP(3);
