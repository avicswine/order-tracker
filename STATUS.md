# STATUS — Order Tracker

Última atualização: 2026-03-14 (sessão 12)

## Estado atual
Aplicação funcional com autenticação JWT (ADMIN/VIEWER), pronta para deploy no Railway.
Sync automático do Bling + rastreamento roda na inicialização do backend e a cada 2h.

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
- Sync automático na startup (após Bling sync) e a cada 2h via cron
- Pedidos sem transportadora com API (BRASPRESS, TNT, AZUL, TEX, etc.) permanecem PENDING — comportamento esperado
- Campos rastreados: status, lastEvent, shippedAt, estimatedDelivery, hasOccurrence, trackingEvents (histórico)
- Backfill de datas: POST /api/tracking/backfill

### Transportadoras
- CRUD completo
- Deduplicação: ATUAL CARGAS consolidada em um único registro (CNPJ 08.848.231/0013-03)
- Nomes padronizados em maiúsculas
- `resolveCarrier` busca por nome antes de criar nova transportadora — evita duplicatas por filiais com CNPJs diferentes

### Ranking
- Página /ranking com desempenho por transportadora
- Métricas: total envios, entregues, atrasados, cancelados, taxa de atraso, prazo médio, valor total NFs
- Filtro por período (botões 30/60 dias ou datas manuais) — filtra por nfIssuedAt
- Tabela ordenável por qualquer coluna
- Backfill de nfValue e nfIssuedAt: POST /api/bling/backfill-nf-values
- **Regra de atraso:** pedido só é considerado atrasado a partir do dia seguinte à previsão (comparação por data, sem hora)
- **Atrasos permanentes:** pedidos entregues com `deliveredAt > estimatedDelivery` continuam contados mesmo após entrega

### Bling
- POST /api/bling/sync — importa NFs dos últimos 90 dias com paginação completa
- Regra: NFs sem transportadora rastreável (Mercado Envios, sem CNPJ) são ignoradas
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

## Transportadoras bloqueadas (não importar do Bling)
Lista em `bling.ts:CARRIERS_BLOCKED` — pedidos ignorados no sync, transportadoras apagadas do banco:
- GARBERG (1 pedido apagado)
- TNT (20 pedidos apagados)
- HS MOVERE (3 pedidos apagados)

## Decisões pendentes
- Rodonaves: endpoint v3/package + fallback brudam. Pedido AGRO-NF-002987 retorna "Não localizado" — pode ser NF antiga ou fora do range da API.
- Transportadoras sem API de rastreamento (AZUL, TEX, ALFA): pedidos ficam PENDING permanentemente.
- EQUI-NF-000019 (TRD): não localizado na API Senior com CNPJ da Equipage — possível segundo CNPJ/filial da TRD para investigar.

## Implementado (sessão 12)

### Deploy Railway + SSE + São Miguel
- Deploy Railway funcional com auto-deploy via GitHub
- **Cloudflare Worker proxy** criado (`sm-proxy-worker.js`) para contornar bloqueio de IP da São Miguel na porta 40490
  - URL: `https://little-lab-f6c5.avicswine.workers.dev`
  - Variável Railway: `SM_PROXY_URL`
- **SSE (Server-Sent Events)** para progresso em tempo real do rastreamento
  - Corrigida chave do token (`'token'` → `'order_tracker_token'`)
  - Adicionado header `X-Accel-Buffering: no` para desativar buffer do Nginx/Railway
- **Braspress:** URL trocada de `api.braspress.com` (bloqueada) para `blue.braspress.com` (pública, HTML)
- **Rastreamento paralelo:** processamento de 5 pedidos simultâneos (sem delay)
- **Modal de progresso:** barra de progresso + NF atual + empresa + lista de erros agrupada por empresa + botão copiar + botão X para cancelar
- **Sync São Miguel automático:** após sync geral, roda sync específico SM via `GET /api/tracking/sync-stream-sm`
- **Scrip diagnóstico São Miguel:** `sync-sm-now.mjs` executado manualmente — atualizou 16+ pedidos EQUI/AGRO

### Correções de dados
- **54 previsões de entrega inválidas** removidas do banco (estimatedDelivery < shippedAt)
  - Causa: API São Miguel retorna `expectedDate` desatualizado (previsão antiga que já passou)
  - Fix no código: sync não salva `estimatedDelivery` se for anterior a `shippedAt`
- **PAC bloqueado** com regex de palavra completa (`\bPAC\b`) — evita bloquear DESPACHOS
- **VICTORIA CARGAS:** 2 pedidos apagados por engano pelo filtro PAC — reimportar via Bling

### Análise de datas (14/03/2026)
Resultado do `review-dates.mjs`:
- **13 NFs com enviado = sábado 14/03:** Atual Cargas, Azurelog, Mengue — provavelmente NF emitida hoje (normal) ou data de registro da transportadora. AVIC-NF-009036 tem 15/02 (domingo) — suspeito
- **17 NFs sem data de envio:** transportadoras sem API (B. Transportes, Leomar, Mengue sem sistema, TRD sem dados)
- **11 NFs com previsão vencida:** maioria Braspress — precisam de sync para atualizar status ou confirmar ocorrência

## Pendências para próxima sessão

### Prioritário
1. **NFs com previsão vencida** — verificar se foram entregues ou têm ocorrência (rodar sync Braspress/Rodonaves)
   - AGRO: 002948, 003002, 003040, 003126, 003141
   - AVIC: 009012, 009036, 009094, 009095, 009115, 009246
2. **AVIC-NF-009036 (São Miguel)** — shippedAt = 15/02 (domingo), previsão 16/02 vencida — verificar se foi entregue
3. **NFs a importar:** 9459 AVIC, 3128 AGRO, 3167 AGRO (não existem no banco ainda — importar via Bling)
4. **AGRO-NF-003128:** transportadora real é MENGUE (não São Miguel) — corrigir após importar

### Transportadoras sem rastreio (ficam PENDING permanentemente)
- B. TRANSPORTES LTDA
- Expresso Leomar Ltda
- AZURELOG (parcialmente — SSW retorna "Informação não disponível")
- MENGUE EXPRESS (parcialmente)
- TRD: EQUI-NF-000019 e 000067 sem dados na API Senior

### Scripts úteis disponíveis
```bash
railway run node backend/sync-sm-now.mjs      # sync manual São Miguel
railway run node backend/review-dates.mjs     # análise geral de datas
railway run node backend/fix-dates.mjs        # remove previsões < enviado
railway run node backend/test-nf.mjs          # diagnóstico de NF específica (editar antes)
railway run node backend/test-sm-prod.mjs     # testa API São Miguel na produção
```

## Implementado (sessão 11)
- **hasOccurrence:** coluna `Boolean @default(false)` adicionada ao schema (migration `20260313104642_add_has_occurrence`)
- `runTrackingSync` agora salva `hasOccurrence` no banco a cada sync
- Novo endpoint `POST /api/tracking/backfill-occurrence` — varre `trackingEvents` existente e detecta keywords de intercorrência; backfill executado: 1/282 detectado
- **Ranking:** nova coluna "Ocorrências" (count + %) ordenável; `occurrences` e `occurrenceRate` retornados pela API
- **Lista de pedidos:** badge ⚠️ agora usa `order.hasOccurrence` (campo confiável do banco) em vez de `isOccurrenceEvent(lastTracking)` (heurística)

## Implementado (sessão 10)
- **Braspress:** rastreamento implementado e funcional
  - Credenciais por empresa no `.env`: `BRASPRESS_AVIC_*` e `BRASPRESS_AGROGRANJA_*` (Equipage não usa Braspress)
  - `trackBraspress` reescrito para o formato real da API (`conhecimentos[]`) — formato era diferente do assumido originalmente
  - `braspressAuth` agora seleciona credencial pelo CNPJ remetente (mapa `BRASPRESS_CREDS`)
  - Transportadora no banco atualizada: `trackingSystem NONE → BRASPRESS`
  - Sync executado: 17/17 atualizados (14 DELIVERED, 2 IN_TRANSIT, 1 não localizado — AGRO-NF-003006)

## Implementado (sessão 9)
- **Aba Pedidos:** filtros de data inicial/final removidos; substituídos por botões de preset 10 · 20 · 30 · 60 · 90 dias (igual ao ranking) filtrando por `shippedStartDate`
- **Aba Pedidos:** botão WhatsApp agora copia o número para a área de transferência (CTRL+V) em vez de abrir link; exibe "COPIADO" por 2 segundos após clicar
- **Aba Ranking:** coluna "Prazo médio" substituída por "Média atraso" — média de dias de atraso entre os pedidos atrasados da transportadora (ex: `+3d`)
- Arquivos temporários de debug apagados da raiz do backend (check_sm.js, check_sm2.js, get_admin.js, show_ranking.js, test_sm.js)


## Implementado (sessão 8)
- Filtros de período no ranking substituídos por botões de preset: 10 · 20 · 30 · 60 · 90 dias
  - Clique no botão ativo deseleciona (toggle)
  - Botão "Limpar" aparece enquanto algum filtro estiver ativo
  - Inputs de data inicial/final removidos
- Sync de rastreamento executado: 84/84 atualizados, 0 erros

## Implementado (sessão 7)
- Tooltip de atrasados no ranking: passar o mouse sobre o número de atrasados exibe janela suspensa (440px) com lista de NFs ordenada do mais atrasado ao menos
  - Campos: NF, cliente, data de envio, previsão de entrega, data de entrega (quando entregue) e badge `+Xd atraso`
  - Botão RASTREIO no tooltip abre o site da transportadora em nova aba (SAO_MIGUEL, SSW, RODONAVES, ATUAL_CARGAS)
  - Tooltip não some ao mover o mouse para cima dele — timer 150ms cancelado se mouse entrar na janela
  - Renderizado via `createPortal` no `body` — sobrepõe tudo (cabeçalho, sidebar), sem corte
  - Posicionamento `fixed` calculado por `getBoundingClientRect()` — sempre alinhado ao número
  - Fecha automaticamente ao rolar a página
- Backend: `GET /carriers/ranking` agora retorna `delayedOrders[]` com detalhes de cada pedido atrasado
- Sync de rastreamento executado: 85/86 atualizados
- AVIC-NF-008230 e AGRO-NF-002110 (SAO MIGUEL, dezembro/2025) marcados manualmente como DELIVERED — NFs antigas fora do histórico da API (janela de retenção excedida)
- API SAO MIGUEL confirmada funcional para NFs recentes

## Implementado (sessão 6)
- Botão "Últimos 30 dias" nos filtros (baseado em `shippedAt`) — filtra lista de pedidos e cards de resumo
- Cards de resumo respeitam o filtro `shippedStartDate` (queryKey e API atualizados)
- Badge "atrasado" exibe dias de atraso: ex. `3d atraso`
- Email do cliente clicável (`mailto:`) na tabela e no modal de detalhes
- Script `enrich-emails.ts` criado e executado: 40 pedidos enriquecidos com email do Bling (71 sem email → 31 restam sem dados)
- Retry automático para rate limit 429 da API do Bling no script de enriquecimento
- **Bug crítico corrigido:** `deliveredAt` era gravado como `new Date()` (data do sync) ao invés da data real de entrega
  - Causa: transportadoras como SAO MIGUEL tinham taxa de atraso de 92% (falsa) — pedidos entregues no prazo apareciam como 50-80 dias atrasados
  - Fix em `tracking.ts`: usa `result.events[0].date` (evento real de entrega) como `deliveredAt`; fallback para `new Date()`
  - Backfill executado: 153 pedidos corrigidos com data real extraída do `trackingEvents` armazenado
  - SAO MIGUEL: 92.2% → 22.5% de atraso (23 atrasos reais restantes)

## Correções aplicadas (sessão 5)
- `endDate` no filtro de pedidos não incluía o dia inteiro (bug: `T00:00:00Z`) — corrigido para `T23:59:59.999`
- Log de dados sensíveis de clientes no console do Bling — removido
- DELETE de transportadora com pedidos vinculados agora retorna mensagem amigável (409)
- Login sem try/catch — corrigido
- `CARRIERS_BLOCKED` agora cobre também busca por CNPJ (caso carrier seja recriada manualmente)
- `BlingSync.tsx` migrado do axios global para instância `api` do lib/api.ts
- `invalidateQueries(['summary'])` ineficaz no BlingSync — corrigido para `['orders']`
- 4 erros de TypeScript em `bling.ts` corrigidos (tipo `unknown` sem cast, `number` onde esperava `string`)
- Arquivos temporários para apagar manualmente: `backend/debug2.ts`, `backend/debug3.ts`, `backend/src/scripts/` (exceto `create-user.ts`)
