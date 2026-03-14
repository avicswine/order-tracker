-- CreateTable
CREATE TABLE "bling_tokens" (
    "id" TEXT NOT NULL,
    "companyKey" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bling_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bling_tokens_companyKey_key" ON "bling_tokens"("companyKey");
