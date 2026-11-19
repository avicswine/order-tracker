-- CreateTable
CREATE TABLE "difal_lotes_gnre" (
    "id" TEXT NOT NULL,
    "empresa" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL,
    "xml" TEXT NOT NULL,
    "guias" INTEGER NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEm" TIMESTAMP(3),
    "numeroRecibo" TEXT,
    "situacaoCodigo" TEXT,
    "situacaoDescricao" TEXT,
    "consultadoEm" TIMESTAMP(3),
    "resultadoXml" TEXT,
    "pdfGuias" TEXT,

    CONSTRAINT "difal_lotes_gnre_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "difal_lotes_gnre_empresa_criadoEm_idx" ON "difal_lotes_gnre"("empresa", "criadoEm");
