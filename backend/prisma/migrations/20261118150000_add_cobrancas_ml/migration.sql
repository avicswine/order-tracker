-- CreateTable
CREATE TABLE "difal_cobrancas_ml" (
    "id" TEXT NOT NULL,
    "empresa" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "natureza" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "difal_cobrancas_ml_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "difal_cobrancas_ml_empresa_periodo_idx" ON "difal_cobrancas_ml"("empresa", "periodo");
