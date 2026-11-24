-- AlterTable
ALTER TABLE "difal_notas" ADD COLUMN "arquivoPagamentoId" TEXT;

-- CreateTable
CREATE TABLE "difal_arquivos_pagamento" (
    "id" TEXT NOT NULL,
    "empresa" TEXT NOT NULL,
    "sequencial" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "guias" INTEGER NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "conteudo" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "difal_arquivos_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "difal_arquivos_pagamento_empresa_sequencial_key" ON "difal_arquivos_pagamento"("empresa", "sequencial");
