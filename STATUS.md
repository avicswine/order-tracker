# STATUS — Order Tracker

Última atualização: 2026-02-27 (sessão 3)

## Estado atual
Aplicação funcional com autenticação JWT (ADMIN/VIEWER), pronta para deploy no Railway.

## Stack
- **Backend:** Express + TypeScript + Prisma + PostgreSQL (porta 3001)
- **Frontend:** React + Vite + TailwindCSS (porta 5173)
- **Bling OAuth2:** multi-empresa — Avic (AVIC), Agrogranja (AGRO), Equipage (EQUI)

## Como iniciar
```bash
# Backend
cd backend && npm run dev

# Frontend
cd frontend && npm run dev

# Matar backend no Windows (quando tsx watch não recarrega)
powershell.exe -Command "Stop-Process -Id <PID> -Force"
# PID: netstat -ano | grep :3001
```

## Funcionalidades implementadas

### Pedidos
- Importação automática de NFs via Bling OAuth2 (multi-empresa)
- Deduplicação por nfNumber + senderCnpj
- Campos: orderNumber, customerName, nfNumber, nfValue, nfIssuedAt, senderCnpj, recipientCnpj, carrierId
- Filtros: status, empresa, transportadora, nº NF, período, atrasados
- Ordenação por data de envio ou previsão de entrega

### Rastreamento
- Sistemas suportados: SSW, Senior (TCK), SAO_MIGUEL, ATUAL_CARGAS, RODONAVES, BRASPRESS, PUPPETEER (ESM)
- Sync automático a cada 2h via cron
- Campos rastreados: status, lastEvent, shippedAt, estimatedDelivery, hasOccurrence, trackingEvents (histórico)
- Backfill de datas: POST /api/tracking/backfill

### Transportadoras
- CRUD completo
- Deduplicação: ATUAL CARGAS consolidada em um único registro (CNPJ 08.848.231/0013-03)
- Nomes padronizados em maiúsculas

### Ranking
- Página /ranking com desempenho por transportadora
- Métricas: total envios, entregues, atrasados, cancelados, taxa de atraso, prazo médio, valor total NFs
- Filtro por período (botões 30/60 dias ou datas manuais) — filtra por nfIssuedAt
- Tabela ordenável por qualquer coluna
- Backfill de nfValue e nfIssuedAt: POST /api/bling/backfill-nf-values
- **Atrasos permanentes:** pedidos entregues com `deliveredAt > estimatedDelivery` (comparação por data, sem hora) continuam contados no ranking mesmo após entrega

### Bling
- POST /api/bling/sync — importa NFs dos últimos 90 dias
- POST /api/bling/enrich — vincula transportadoras em pedidos sem carrier
- POST /api/bling/backfill-nf-values — preenche nfValue e nfIssuedAt nos pedidos existentes

## Schema — campos relevantes (Order)
| Campo            | Tipo      | Descrição                        |
|------------------|-----------|----------------------------------|
| nfNumber         | String?   | Número da NF                     |
| nfValue          | Float?    | Valor total da NF (do Bling)     |
| nfIssuedAt       | DateTime? | Data de emissão da NF (do Bling) |
| senderCnpj       | String?   | CNPJ do remetente                |
| carrierId        | String?   | FK para Carrier                  |
| shippedAt        | DateTime? | Data de coleta/envio (rastreio)  |
| estimatedDelivery| DateTime? | Previsão de entrega (rastreio)   |
| trackingEvents   | Json?     | Histórico de eventos             |

## Autenticação (sessão 3)
- JWT com 7 dias de validade, `JWT_SECRET` no `.env`
- Roles: `ADMIN` (full access) | `VIEWER` (só leitura)
- VIEWER: botões Novo Pedido, Nova Transportadora, Editar, Excluir, BlingSync e Atualizar Status ficam ocultos
- Criar usuário admin: `cd backend && npx tsx src/scripts/create-user.ts "Nome" "email@email.com" "senha" ADMIN`
- Logout no rodapé da sidebar (mostra nome e role)

## Deploy — Railway
Arquivos criados na raiz: `railway.toml`, `nixpacks.toml`, `package.json`

### Variáveis obrigatórias no Railway
| Variável                    | Valor                                          |
|-----------------------------|------------------------------------------------|
| DATABASE_URL                | fornecido pelo PostgreSQL do Railway           |
| NODE_ENV                    | production                                     |
| JWT_SECRET                  | chave longa e aleatória                        |
| BLING_REDIRECT_URI          | https://\<url-railway\>/api/bling/callback     |
| PUPPETEER_EXECUTABLE_PATH   | /run/current-system/sw/bin/chromium            |
| BLING_AVIC_CLIENT_ID/SECRET | credenciais Bling Avic                         |
| BLING_AGROGRANJA_*          | credenciais Bling Agrogranja                   |
| BLING_EQUIPAGE_*            | credenciais Bling Equipage                     |
| BRASPRESS_USER/PASSWORD     | credenciais Braspress                          |
| ATUAL_CARGAS_DOCUMENT/PASSWORD | credenciais Atual Cargas                    |

### Passos do deploy
1. Push do projeto para GitHub
2. railway.app → New Project → Deploy from GitHub repo
3. Adicionar serviço PostgreSQL no Railway
4. Configurar variáveis de ambiente
5. Deploy automático via push
6. Criar usuário admin via script (com connection string do Railway)

## Outros
- Atalho no desktop (`Order Tracker.lnk`) aponta para `iniciar.bat` com ícone personalizado (`icon.ico`)

## Decisões pendentes
- Rodonaves: endpoint v3/package + fallback brudam. Pedido AGRO-NF-002987 retorna "Não localizado" — pode ser NF antiga ou fora do range da API.
- Transportadoras sem sistema de rastreamento (BRASPRESS, TNT, AZUL, TEX): configurar ou ignorar.
