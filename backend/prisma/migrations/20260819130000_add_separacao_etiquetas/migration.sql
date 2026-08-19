-- CreateTable
CREATE TABLE "separacao_etiquetas" (
    "id" TEXT NOT NULL,
    "companyKey" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "impressoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "impressoPorId" TEXT,

    CONSTRAINT "separacao_etiquetas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "separacao_etiquetas_companyKey_sku_key" ON "separacao_etiquetas"("companyKey", "sku");

