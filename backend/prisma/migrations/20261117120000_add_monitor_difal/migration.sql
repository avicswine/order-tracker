-- CreateEnum
CREATE TYPE "DifalResponsavel" AS ENUM ('ML_PAGA', 'NOSSO', 'CLIENTE', 'SEM_DIFAL');

-- CreateEnum
CREATE TYPE "DifalSituacao" AS ENUM ('PENDENTE', 'CONFERIDO', 'DIVERGENTE', 'PAGO', 'ATRASADO');


-- CreateTable
CREATE TABLE "difal_notas" (
    "id" TEXT NOT NULL,
    "empresa" TEXT NOT NULL,
    "nfNumero" TEXT NOT NULL,
    "nfSerie" TEXT,
    "nfChave" TEXT,
    "blingId" TEXT,
    "emitidaEm" TIMESTAMP(3) NOT NULL,
    "naturezaOperacao" TEXT,
    "clienteNome" TEXT NOT NULL,
    "clienteUf" TEXT NOT NULL,
    "clienteTemIe" BOOLEAN NOT NULL DEFAULT false,
    "clienteIe" TEXT,
    "valorProdutos" DOUBLE PRECISION NOT NULL,
    "valorFrete" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "valorNota" DOUBLE PRECISION NOT NULL,
    "valorComReducao" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "valorSemReducao" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "canalId" TEXT,
    "canalNome" TEXT,
    "canalTipo" TEXT,
    "mlOrderId" TEXT,
    "mlPackId" TEXT,
    "difalCalculado" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difalMetodo" TEXT,
    "calculoDetalhe" JSONB,
    "difalCobradoMl" DOUBLE PRECISION,
    "cobradoMlEm" TIMESTAMP(3),
    "difalPagoGuia" DOUBLE PRECISION,
    "guiaPagaEm" TIMESTAMP(3),
    "responsavel" "DifalResponsavel" NOT NULL DEFAULT 'NOSSO',
    "situacao" "DifalSituacao" NOT NULL DEFAULT 'PENDENTE',
    "divergencia" DOUBLE PRECISION,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "difal_notas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "difal_aliquotas" (
    "uf" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "aliquotaInterna" DOUBLE PRECISION NOT NULL,
    "fcp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interestadual" DOUBLE PRECISION NOT NULL DEFAULT 7,
    "metodo" TEXT NOT NULL DEFAULT 'carga',
    "posicaoFisco" BOOLEAN NOT NULL DEFAULT false,
    "nota" TEXT,
    "guiasComReducao" INTEGER,
    "guiasTotal" INTEGER,
    "metodoObservado" TEXT,
    "evidenciaEm" TIMESTAMP(3),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "difal_aliquotas_pkey" PRIMARY KEY ("uf")
);

-- CreateIndex
CREATE UNIQUE INDEX "difal_notas_nfChave_key" ON "difal_notas"("nfChave");

-- CreateIndex
CREATE INDEX "difal_notas_emitidaEm_idx" ON "difal_notas"("emitidaEm");

-- CreateIndex
CREATE INDEX "difal_notas_responsavel_situacao_idx" ON "difal_notas"("responsavel", "situacao");

-- CreateIndex
CREATE INDEX "difal_notas_clienteUf_idx" ON "difal_notas"("clienteUf");

-- CreateIndex
CREATE INDEX "difal_notas_mlOrderId_idx" ON "difal_notas"("mlOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "difal_notas_empresa_nfNumero_key" ON "difal_notas"("empresa", "nfNumero");
