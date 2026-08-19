-- CreateEnum
CREATE TYPE "SeparacaoStatus" AS ENUM ('AGUARDANDO_TRIAGEM', 'PENDENTE', 'IGNORADA', 'EM_SEPARACAO', 'SEPARADO', 'CONCLUIDO', 'CANCELADA');

-- CreateEnum
CREATE TYPE "SeparacaoEventoTipo" AS ENUM ('TRIAGEM', 'INICIO', 'BIPE_OK', 'BIPE_ERRADO', 'BIPE_EXCEDENTE', 'QTD_MANUAL', 'PESO_OK', 'PESO_FORA', 'LIBERACAO', 'SEPARADO', 'FINALIZADO', 'CANCELADO', 'REABERTO');

-- CreateTable
CREATE TABLE "separacao_operadores" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "supervisor" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "separacao_operadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "separacao_tarefas" (
    "id" TEXT NOT NULL,
    "companyKey" TEXT NOT NULL,
    "blingNfId" TEXT NOT NULL,
    "nfNumero" TEXT NOT NULL,
    "nfSerie" TEXT,
    "nfEmitidaEm" TIMESTAMP(3),
    "clienteNome" TEXT NOT NULL,
    "canal" TEXT,
    "valorNota" DOUBLE PRECISION,
    "orderId" TEXT,
    "status" "SeparacaoStatus" NOT NULL DEFAULT 'AGUARDANDO_TRIAGEM',
    "itensCarregados" BOOLEAN NOT NULL DEFAULT false,
    "observacao" TEXT,
    "triadoPorId" TEXT,
    "triadoEm" TIMESTAMP(3),
    "operadorId" TEXT,
    "iniciadoEm" TIMESTAMP(3),
    "separadoEm" TIMESTAMP(3),
    "finalizadoPorId" TEXT,
    "concluidoEm" TIMESTAMP(3),
    "pesoConferido" BOOLEAN NOT NULL DEFAULT false,
    "pesoCaixaLido" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "separacao_tarefas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "separacao_itens" (
    "id" TEXT NOT NULL,
    "tarefaId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "fotoUrl" TEXT,
    "blingProdutoId" TEXT,
    "origemKit" TEXT,
    "qtdEsperada" DOUBLE PRECISION NOT NULL,
    "qtdBipada" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qtdManual" BOOLEAN NOT NULL DEFAULT false,
    "pesoUnit" DOUBLE PRECISION,
    "pesoLido" DOUBLE PRECISION,
    "pesoOk" BOOLEAN,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "separacao_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "separacao_eventos" (
    "id" TEXT NOT NULL,
    "tarefaId" TEXT NOT NULL,
    "operadorId" TEXT,
    "itemId" TEXT,
    "sku" TEXT,
    "tipo" "SeparacaoEventoTipo" NOT NULL,
    "qtd" DOUBLE PRECISION,
    "detalhe" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "separacao_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "separacao_config" (
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "separacao_config_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE UNIQUE INDEX "separacao_operadores_nome_key" ON "separacao_operadores"("nome");

-- CreateIndex
CREATE INDEX "separacao_tarefas_status_idx" ON "separacao_tarefas"("status");

-- CreateIndex
CREATE INDEX "separacao_tarefas_companyKey_nfNumero_idx" ON "separacao_tarefas"("companyKey", "nfNumero");

-- CreateIndex
CREATE INDEX "separacao_tarefas_nfEmitidaEm_idx" ON "separacao_tarefas"("nfEmitidaEm");

-- CreateIndex
CREATE UNIQUE INDEX "separacao_tarefas_companyKey_blingNfId_key" ON "separacao_tarefas"("companyKey", "blingNfId");

-- CreateIndex
CREATE INDEX "separacao_itens_tarefaId_sku_idx" ON "separacao_itens"("tarefaId", "sku");

-- CreateIndex
CREATE INDEX "separacao_eventos_tarefaId_criadoEm_idx" ON "separacao_eventos"("tarefaId", "criadoEm");

-- CreateIndex
CREATE INDEX "separacao_eventos_tipo_criadoEm_idx" ON "separacao_eventos"("tipo", "criadoEm");

-- AddForeignKey
ALTER TABLE "separacao_tarefas" ADD CONSTRAINT "separacao_tarefas_triadoPorId_fkey" FOREIGN KEY ("triadoPorId") REFERENCES "separacao_operadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "separacao_tarefas" ADD CONSTRAINT "separacao_tarefas_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "separacao_operadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "separacao_tarefas" ADD CONSTRAINT "separacao_tarefas_finalizadoPorId_fkey" FOREIGN KEY ("finalizadoPorId") REFERENCES "separacao_operadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "separacao_itens" ADD CONSTRAINT "separacao_itens_tarefaId_fkey" FOREIGN KEY ("tarefaId") REFERENCES "separacao_tarefas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "separacao_eventos" ADD CONSTRAINT "separacao_eventos_tarefaId_fkey" FOREIGN KEY ("tarefaId") REFERENCES "separacao_tarefas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "separacao_eventos" ADD CONSTRAINT "separacao_eventos_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "separacao_operadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "separacao_eventos" ADD CONSTRAINT "separacao_eventos_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "separacao_itens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

