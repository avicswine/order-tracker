-- Caixa de entrada das notificações do ML para o cmvsync (que não tem URL pública)
CREATE TABLE "ml_notificacoes" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "mlUserId" TEXT,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entregueEm" TIMESTAMP(3),
    "payload" JSONB,
    CONSTRAINT "ml_notificacoes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ml_notificacoes_entregueEm_recebidoEm_idx" ON "ml_notificacoes"("entregueEm", "recebidoEm");
