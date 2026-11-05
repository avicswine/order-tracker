CREATE TABLE "ml_conversas_pendentes" (
    "packId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "comprador" TEXT NOT NULL,
    "item" TEXT,
    "naoLidas" INTEGER NOT NULL DEFAULT 1,
    "mensagens" JSONB,
    "ultimaEm" TIMESTAMP(3),
    "respondida" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ml_conversas_pendentes_pkey" PRIMARY KEY ("packId")
);
CREATE INDEX "ml_conversas_pendentes_respondida_idx" ON "ml_conversas_pendentes"("respondida");
