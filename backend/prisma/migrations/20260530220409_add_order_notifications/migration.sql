-- CreateTable
CREATE TABLE "order_notifications" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventHash" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,

    CONSTRAINT "order_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_notifications_orderId_eventHash_key" ON "order_notifications"("orderId", "eventHash");

-- AddForeignKey
ALTER TABLE "order_notifications" ADD CONSTRAINT "order_notifications_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
