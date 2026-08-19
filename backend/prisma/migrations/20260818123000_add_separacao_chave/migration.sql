-- AlterTable
ALTER TABLE "separacao_tarefas" ADD COLUMN     "chaveAcesso" TEXT;

-- CreateIndex
CREATE INDEX "separacao_tarefas_chaveAcesso_idx" ON "separacao_tarefas"("chaveAcesso");

