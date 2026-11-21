-- AlterTable: rastreio do Mercado Envios nas notas do DIFAL
ALTER TABLE "difal_notas" ADD COLUMN     "mlEnvioId" TEXT,
ADD COLUMN     "mlEnvioStatus" TEXT,
ADD COLUMN     "mlEnvioSubstatus" TEXT,
ADD COLUMN     "mlPrevisao" TIMESTAMP(3),
ADD COLUMN     "mlEnvioLidoEm" TIMESTAMP(3);
