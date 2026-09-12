-- Mercado Envios 1: avisos de envio ao ML (shipped/delivered) a partir do rastreio próprio
ALTER TABLE "orders" ADD COLUMN "mlCompany" TEXT;
ALTER TABLE "orders" ADD COLUMN "mlOrderId" TEXT;
ALTER TABLE "orders" ADD COLUMN "mlShipmentId" TEXT;
ALTER TABLE "orders" ADD COLUMN "mlShippedNotifiedAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "mlDeliveredNotifiedAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "mlEnvioErro" TEXT;
ALTER TABLE "orders" ADD COLUMN "mlVinculoTentadoAt" TIMESTAMP(3);

CREATE INDEX "orders_mlShipmentId_idx" ON "orders"("mlShipmentId");
