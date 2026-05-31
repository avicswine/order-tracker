/*
  Warnings:

  - The primary key for the `whatsapp_sessions` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `creds` on the `whatsapp_sessions` table. All the data in the column will be lost.
  - You are about to drop the column `id` on the `whatsapp_sessions` table. All the data in the column will be lost.
  - You are about to drop the column `keys` on the `whatsapp_sessions` table. All the data in the column will be lost.
  - Added the required column `files` to the `whatsapp_sessions` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "whatsapp_sessions_company_key";

-- AlterTable
ALTER TABLE "whatsapp_sessions" DROP CONSTRAINT "whatsapp_sessions_pkey",
DROP COLUMN "creds",
DROP COLUMN "id",
DROP COLUMN "keys",
ADD COLUMN     "files" TEXT NOT NULL,
ADD CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("company");
