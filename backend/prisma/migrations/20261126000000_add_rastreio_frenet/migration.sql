-- AlterEnum
ALTER TYPE "TrackingSystem" ADD VALUE 'FRENET';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "trackingCode" TEXT,
ADD COLUMN "trackingUrl" TEXT,
ADD COLUMN "frenetShipmentId" TEXT,
ADD COLUMN "frenetServico" TEXT,
ADD COLUMN "silenciarProximoAviso" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "orders_frenetShipmentId_key" ON "orders"("frenetShipmentId");
