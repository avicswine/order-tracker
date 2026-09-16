-- Vendas do ML no formato "combinar entrega" (sem envio): a entrega é informada
-- pelo feedback do pedido (fulfilled = true), não pelo seller_notifications do ME1.
ALTER TABLE "orders" ADD COLUMN "mlSemEnvio" BOOLEAN NOT NULL DEFAULT false;
