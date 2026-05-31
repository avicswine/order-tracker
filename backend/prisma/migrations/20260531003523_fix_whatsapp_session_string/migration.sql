-- Recria a tabela de sessões WhatsApp do zero (dados são descartáveis — só sessão Baileys)
-- Idempotente: resolve o estado parcial da migração que falhou em produção (P3009)
DROP TABLE IF EXISTS "whatsapp_sessions";

CREATE TABLE "whatsapp_sessions" (
    "company" TEXT NOT NULL,
    "files" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("company")
);
