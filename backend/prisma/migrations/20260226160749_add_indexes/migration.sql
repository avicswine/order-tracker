-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_nfNumber_idx" ON "orders"("nfNumber");

-- CreateIndex
CREATE INDEX "orders_estimatedDelivery_status_idx" ON "orders"("estimatedDelivery", "status");
