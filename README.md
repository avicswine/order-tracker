# Order Tracker

Dashboard de rastreamento de pedidos com React + Node.js + PostgreSQL.

## Requisitos

- Node.js 18+
- PostgreSQL 14+

## Setup

### 1. Backend

```bash
cd backend
npm install

# Copie e configure o .env
cp .env.example .env
# Edite DATABASE_URL com suas credenciais do PostgreSQL

# Gere o cliente Prisma e rode as migrations
npm run db:generate
npm run db:migrate

# (Opcional) Popule com dados de exemplo
npm run db:seed

# Inicie o servidor de desenvolvimento
npm run dev
```

O backend roda em `http://localhost:3001`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

O frontend roda em `http://localhost:5173`.

## Estrutura

```
order-tracker/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma       # Schema do banco (Carrier, Order, StatusHistory)
│   └── src/
│       ├── lib/prisma.ts       # Cliente Prisma singleton
│       ├── routes/
│       │   ├── carriers.ts     # CRUD de transportadoras
│       │   └── orders.ts       # CRUD + filtros + status de pedidos
│       ├── seed.ts             # Dados de exemplo
│       └── server.ts           # Entry point Express
└── frontend/
    └── src/
        ├── components/
│       │   ├── carriers/       # CarrierForm modal
│       │   ├── layout/         # Sidebar + Layout
│       │   ├── orders/         # SummaryCards, Filters, Table, Modals
│       │   └── ui/             # Badge, Modal, Spinner
        ├── lib/
│       │   ├── api.ts          # Axios wrappers
│       │   └── utils.ts        # Formatadores, labels de status
        ├── pages/
│       │   ├── OrdersPage.tsx
│       │   └── CarriersPage.tsx
        └── types/index.ts      # Tipos TypeScript compartilhados
```

## API Endpoints

### Transportadoras
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/carriers` | Listar todas |
| POST | `/api/carriers` | Criar |
| PUT | `/api/carriers/:id` | Editar |
| DELETE | `/api/carriers/:id` | Excluir |

### Pedidos
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/orders` | Listar com filtros (`status`, `startDate`, `endDate`, `search`, `page`) |
| GET | `/api/orders/summary` | Totais por status |
| GET | `/api/orders/:id` | Detalhes + histórico |
| POST | `/api/orders` | Criar |
| PUT | `/api/orders/:id` | Editar |
| PATCH | `/api/orders/:id/status` | Atualizar status |
| DELETE | `/api/orders/:id` | Excluir |
