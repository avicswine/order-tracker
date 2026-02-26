-- AlterEnum
ALTER TYPE "TrackingSystem" ADD VALUE 'SAO_MIGUEL';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "recipientCnpj" TEXT;
