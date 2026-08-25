-- CreateEnum
CREATE TYPE "PendenciaTipo" AS ENUM ('ATRASO', 'OCORRENCIA', 'DEFEITO', 'ITEM_FALTANTE', 'DEVOLUCAO', 'RECLAMACAO_ML', 'OUTRO');

-- CreateEnum
CREATE TYPE "PendenciaOrigem" AS ENUM ('AUTO', 'MANUAL', 'MERCADO_LIVRE');

-- CreateEnum
CREATE TYPE "PendenciaStatus" AS ENUM ('ABERTA', 'EM_TRATAMENTO', 'RESOLVIDA');

-- CreateTable
CREATE TABLE "pendencias" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "nfNumber" TEXT,
    "customerName" TEXT NOT NULL,
    "senderCnpj" TEXT,
    "tipo" "PendenciaTipo" NOT NULL,
    "origem" "PendenciaOrigem" NOT NULL,
    "status" "PendenciaStatus" NOT NULL DEFAULT 'ABERTA',
    "descricao" TEXT,
    "mlClaimId" TEXT,
    "mlOrderId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pendencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pendencia_notas" (
    "id" TEXT NOT NULL,
    "pendenciaId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "autor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pendencia_notas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ml_tokens" (
    "companyKey" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ml_tokens_pkey" PRIMARY KEY ("companyKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "pendencias_mlClaimId_key" ON "pendencias"("mlClaimId");

-- CreateIndex
CREATE INDEX "pendencias_status_idx" ON "pendencias"("status");

-- CreateIndex
CREATE INDEX "pendencias_senderCnpj_status_idx" ON "pendencias"("senderCnpj", "status");

-- AddForeignKey
ALTER TABLE "pendencias" ADD CONSTRAINT "pendencias_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pendencia_notas" ADD CONSTRAINT "pendencia_notas_pendenciaId_fkey" FOREIGN KEY ("pendenciaId") REFERENCES "pendencias"("id") ON DELETE CASCADE ON UPDATE CASCADE;
