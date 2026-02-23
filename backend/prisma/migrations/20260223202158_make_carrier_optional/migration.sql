-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_carrierId_fkey";

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "carrierId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
