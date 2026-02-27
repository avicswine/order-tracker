# STATUS — Order Tracker

Última atualização: 2026-02-27

## Estado atual
Aplicação funcional com rastreamento automático, sincronização com Bling e página de ranking de transportadoras.

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

## Decisões pendentes
- Rodonaves: endpoint v3/package + fallback brudam. Pedido AGRO-NF-002987 retorna "Não localizado" — pode ser NF antiga ou fora do range da API.
- Transportadoras sem sistema de rastreamento (BRASPRESS, TNT, AZUL, TEX): configurar ou ignorar.
