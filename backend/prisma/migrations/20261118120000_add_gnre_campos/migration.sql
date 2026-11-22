-- Campos que a GNRE exige, por nota e por UF, e o emitente por empresa.

-- AlterTable: o que a guia precisa do destinatário e o rastro da guia gerada
ALTER TABLE "difal_notas"
  ADD COLUMN "municipioIbgeDestino" TEXT,
  ADD COLUMN "documentoDestinatario" TEXT,
  ADD COLUMN "guiaGeradaEm" TIMESTAMP(3),
  ADD COLUMN "guiaLoteId" TEXT;

-- AlterTable: parâmetros da GNRE por UF
ALTER TABLE "difal_aliquotas"
  ADD COLUMN "codigoReceitaGnre" TEXT,
  ADD COLUMN "tipoDocOrigemGnre" TEXT NOT NULL DEFAULT '10',
  ADD COLUMN "vencimentoRegra" TEXT NOT NULL DEFAULT 'saida';

-- CreateTable: dados do emitente como a GNRE pede, lidos do XML das nossas notas
CREATE TABLE "difal_emitentes" (
    "empresa" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "inscricaoEstadual" TEXT,
    "razaoSocial" TEXT NOT NULL,
    "endereco" TEXT NOT NULL,
    "municipioIbge" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "cep" TEXT NOT NULL,
    "telefone" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "difal_emitentes_pkey" PRIMARY KEY ("empresa")
);
