# STATUS — Order Tracker

Última atualização: 2026-11-07 (conformidade com os Termos do Mercado Livre + correção da Rodonaves)

## Regra de trabalho (definida por José em 2026-11-07)

**Toda recomendação ou apontamento de mudança vem com a FONTE** — link, cláusula,
`arquivo:linha` ou a consulta de onde o dado saiu. Sem a fonte lida, dizer explicitamente
que é inferência, nunca apresentar como fato. O motivo: na sessão de 07/11 três
afirmações minhas sobre políticas do ML caíram quando a fonte foi cobrada, gerando
retrabalho e custo.

## Sessão 2026-11-07 — Conformidade ML e Rodonaves

### Implementado e no ar

- **Rodonaves: rastreio decidido pela família do código** (`3c61303`). A transportadora
  usa códigos com subdivisão (`5.1` disponível para retirada, `6.1` retirada na unidade);
  a comparação era pelo código inteiro, o mapeamento devolvia `null`, nada era persistido
  e o pedido ficava IN_TRANSIT para sempre somando atraso falso. Agora decide pela família
  (número antes do ponto), com a checagem de devolução/recusa antes. Verificado: NFs
  013024, 013025 e 013026 passaram a DELIVERED.
  Arquivo: `backend/src/services/tracking.ts`.
- **Venda do ML não é mais notificada fora da plataforma** (`11452e8`). O anexo Marketplace
  dos Termos do ML, cl. 3.b (<https://www.mercadolivre.com.br/ajuda/23050>), proíbe
  comunicação com o comprador por meio que não seja o serviço de mensagens do ML até
  vencer a Compra Protegida. Havíamos enviado 254 mensagens por WhatsApp/e-mail a
  compradores do ML entre 17/07 e 06/11. A checagem ficou dentro de `dispatch()`, que é o
  ponto único por onde passa todo envio ao comprador — nenhum chamador pode esquecer o
  filtro. O rastreio (que o ML não tem) passou a ir pela mensagem pós-venda, curta e sem
  link; faturamento e entrega não são mais avisados por nós porque o ML já informa.
  Arquivos: `backend/src/services/notifier.ts`, `backend/src/services/mlEnvios.ts`.
- **17 descrições de anúncios corrigidas pela API** (7 que ofereciam suporte via WhatsApp
  na AGRO + 10 frases de "entre em contato"/"consulte-nos" em 9 anúncios). Backup dos
  textos originais e gravação só após conferir que o texto ao vivo não mudou.

### Verificado — não havia problema

- **Não existe regra proibindo várias contas** nem vender o mesmo produto em contas
  diferentes, nem duas contas do mesmo dono disputarem o mesmo anúncio de catálogo. O
  Catálogo (<https://www.mercadolivre.com.br/ajuda/4676>, 21/08/2025) é definido como a
  ferramenta "que permite que os anúncios de um mesmo produto compitam entre si", e suas
  únicas regras adicionais tratam de estoque diferido e reputação laranja/vermelha. A cl. 4
  dos Termos só dá poder discricionário ao ML "se considerarmos que essa ação pode
  prejudicar" os demais, e o anexo Marketplace fala em "sanções sobre todas as suas
  contas", presumindo que um vendedor pode ter mais de uma.
- **CNAE da AVIC está correto.** O 4661-3/00 compreende "o comércio atacadista de
  máquinas, aparelhos e equipamentos para uso na avicultura e apicultura"
  (<https://concla.ibge.gov.br/busca-online-cnae.html?view=subclasse&tipo=cnae&versao=10&subclasse=4661300>).
  Só faltaria 4663-0/00 se houver venda relevante para indústria fora do agro.
- **Endereço da AVIC no ML bate com a Receita** (cartão CNPJ de 04/11/2026). As APIs
  públicas de CNPJ estavam defasadas.
- Títulos das duas contas: nenhum termo proibido pela política de fotos/títulos (1024).
- Telefone do comprador enviado à transportadora no ME1: uso legítimo, o ML fornece o
  contato justamente para despachar.

### Próximos passos

Comigo, esperando liberação:
1. Expurgo de dados pessoais no Postgres — `customerName`/`customerEmail`/`customerPhone`
   ficam indefinidamente; o anexo Marketplace, cl. 1.h, manda excluir após cumprida a
   finalidade.
2. Avisar o resultado do primeiro envio real com canal `ML_MENSAGEM` (dirá se o texto
   passa pela moderação do ML).
3. Olhar os 18 erros do sync de rastreio (outras transportadoras, anteriores a esta sessão).
4. Monitor diário de `site_status` / `sell.allow` / `list.allow` / `required_action` das
   contas AVIC e AGRO, com alerta por WhatsApp.
5. Cortar escopos excessivos dos apps do DevCenter (`urn:ml:all:*`,
   `urn:global:admin:oauth:/read-write`) — adiado: exige reautorizar as contas em
   produção, risco maior que o ganho hoje.

Com José:
6. `rm -f "C:/Users/josef/cmvsync/.env.equi.ml.novo"` — contém o Client Secret do ML em
   texto puro (o `rm` é bloqueado para o agente).
7. Marcar `duplicados-ml.xlsx` — 146 anúncios excedentes de título idêntico. **Único item
   da auditoria com proibição escrita atrás**: <https://www.mercadolivre.com.br/ajuda/2517>.
8. Conferir se as fotos têm logo do vendedor ou marca d'água (proibido pela política 1024;
   não dá para verificar por API).
9. Contas Colaboradoras: um e-mail só pode ser colaborador de **uma** conta
   (<https://www.mercadolivre.com.br/ajuda/25781>). Conferir se algum e-mail está na AVIC
   e na AGRO.
10. Descobrir sob qual conta está o app GESTAOENVIOS no DevCenter — a API não devolve
    `owner_id`. Se não for da Equipage, há vínculo técnico com a conta suspensa.
11. Atualizar o endereço da AGROGRANJA no ML quando a alteração sair na Receita.
12. Razão social da AVIC no ML consta "DIRLENE JOANA BAZZANELLA" (razão social original do
    CNPJ); a atual é "AVIC VENTILACAO E EXAUSTAO INDUSTRIAL LTDA". Campo não editável no
    perfil — enviado cartão CNPJ, **em análise**. `required_action: simple_registration` é
    a única pendência cadastral das três contas.

### Decisões pendentes

- **Catálogo sobreposto AVIC × AGRO**: 236 SKUs nas duas contas (481 anúncios AVIC, 427
  AGRO), 141 com venda zero em uma delas, 59 com diferença de preço de 15%+ no mesmo SKU.
  Passou a ser **decisão comercial, não compliance** — nenhuma regra proíbe. O caso mais
  extremo é `PAS001` a R$ 144,88 na AVIC e R$ 349,90 na AGRO. Planilha: `sobrepostos-ml.xlsx`.
- **GTIN inventado**: 804 anúncios ativos com GTIN preenchido (484 AVIC, 320 AGRO), e 50
  dos 375 códigos aparecem em SKUs diferentes — um cobre `RL040.1` até `RL040.1000`, outro
  junta um sensor de palheta com bebedouros de 6, 9 e 15 m. José informou que **os únicos
  GTIN legítimos são os dos códigos PAI no Bling, de BASSO E PANCOTTE e ROBUSTEC**. O ML
  oferece o atributo `EMPTY_GTIN_REASON` ("O produto é um kit ou pack", "O produto não tem
  código cadastrado", entre outros), disponível por categoria. Trabalho adiado.
- EQUIPAGE suspensa: protocolo 49408564 aberto em 05/11, sem resposta. A API ainda devolve
  a conta como `site_status: active`.

### Arquivos gerados nesta sessão

- `REFERENCIA-POLITICAS-ML.md` — os 34 tópicos da Política de Cadastramento de Produtos
  (<https://www.mercadolivre.com.br/ajuda/1011>), texto integral.
- `RELATORIO-DUPLICADOS-ML.md` e `duplicados-ml.xlsx` — anúncios duplicados por conta.
- `descricoes-ml.xlsx` — frases de descrição corrigidas.
- `sobrepostos-ml.xlsx` — produtos nas duas contas, cruzados **só por SKU exato** (GTIN e
  título foram descartados: o GTIN está errado no catálogo e o título não distingue
  variantes de quantidade).

## Módulo de Separação por bipe (novo — em produção desde 2026-08-19)
Plano, decisões e estado: `PLANO-SEPARACAO.md`. URL: `https://order-tracker-production-4189.up.railway.app/separacao`.
- App próprio em `separacao/` (Vite, mobile-first) servido em `/separacao`; API em `/api/separacao`; tabelas `separacao_*`; auth própria (operador + PIN).
- Fluxo: sync de NFs do Bling → triagem no balcão → bipe no celular (QR = SKU) → finalização no balcão. Balança preparada (Web Serial), desativada até chegar o equipamento.
- Validado em produção com NFs reais (kits explodidos, bipe no iPhone, finalização no balcão). Escopos do Bling (Produtos/Canais de venda) liberados em 2026-08-19.
- Poka-yoke: item selecionado trava o bipe (aviso laranja), quantidade digitada só após bipar o QR, DANFE bipada por engano vira aviso, SKU `BASE.N` (ex.: RL040.15) explode em N × BASE.
- Etiquetas: papel Zebra 10×15, abas "Pendentes do dia" / "Por NF" / catálogo, com controle do que já foi impresso.
- Triagem: importa NFs antigas por período (máx. 31 dias) ou por número.
- Migrations novas: `20260818120000_add_separacao`, `20260818123000_add_separacao_chave` (aplicam sozinhas no `npm start` do Railway).
- Dev local: `iniciar.bat` sobe também `separacao/` na porta 5176 (modo `dev:celular` = HTTPS para a câmera do Android). Painel: link "Separação" no Sidebar.

## Estado atual
Aplicação funcional com autenticação JWT (ADMIN/VIEWER), em produção no Railway.
Sync automático do Bling + rastreamento roda na inicialização e a cada 2h.
Notificações automáticas por WhatsApp (AVIC/AGRO) e email (Resend) a cada atualização de rastreio.
URL produção: https://order-tracker-production-4189.up.railway.app/
URL customizada (pendente — Railway plano não suporta domínio custom): https://rastreio.avicswine.com.br
  - DNS configurado corretamente (CNAME + TXT propagados)
  - Bloqueado por limite de domínios do plano Railway atual
  - Solução: upgrade para Hobby ($5/mês) em Settings → Billing

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

## Implementado (sessão 15)
- **Login Gmail corrigido:** `normalizeEmail()` removia pontos do email — trocado por `.trim().toLowerCase()`
- **Portal do Cliente online:** `customer-portal/` deployado em `/portal`, vite.config com `base: '/portal'`, server.ts serve estático em produção
- **Portal Cliente — busca por CNPJ funcionando:** backfill de `recipientCnpj` executado em produção (310/310 pedidos atualizados via Bling API)
- **Sidebar:** link "Portal do Cliente" corrigido de `localhost:5174` para `/portal`
- **SSW shippedAt corrigido:** buscava data do evento mais recente ao invés do mais antigo
  - Fix: seletor `$('[onclick]')` em vez de `$('a')` — captura o link de detalhes mesmo quando está apenas no `<tr>`
  - Página detalhada (`ssw_SSWDetalhado`) usada para obter histórico completo em ordem cronológica
  - `shippedAt = detailEvents[0]` (DOCUMENTO DE TRANSPORTE EMITIDO = evento mais antigo)
  - Backfill executado: 14 pedidos SSW corrigidos (AZURELOG, MENGUE EXPRESS, B. TRANSPORTES)
- **Atual Cargas — "Não localizado" não sobrescreve rastreio:** quando API retorna `status: null`, `lastTracking` e `trackingEvents` não são atualizados — preserva último evento válido
- **NF 9343 AVIC:** marcada manualmente como ENTREGUE (confirmado no site da transportadora — Atual Cargas remove entregues da lista)
- **NF 9285 AVIC:** transportadora alterada para AZURELOG TRANSPORTES LTDA, rastreio refeito

## Implementado (sessão 14)
- **Bug Braspress corrigido:** `braspressMapStatus` retornava IN_TRANSIT para "Entrega Realizada" porque `s.includes('ENTREGA')` capturava o evento antes do fallback
  - Fix: check explícito para "ENTREGA REALIZADA" e "ENTREGA EFETUADA" antes do bloco IN_TRANSIT
  - 8 NFs atualizadas para DELIVERED após re-sync: AGRO 002948, 003002, 003040, 003141 | AVIC 009012, 009094, 009095, 009115
- `getTrackingUrl` e `buildOrderTrackingUrl`: adicionado caso ATUAL_CARGAS; NONE usa `trackingIdentifier` como URL manual
- Sidebar: link Power BI adicionado (localhost:5175, temporário)
- URL de produção Railway salva no STATUS.md

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

## Implementado (sessão 16)

### Correção crítica — banco resetado
- Banco de dados havia sido resetado: todas as transportadoras perderam `trackingSystem`
- Restauradas via API: SSW (Azurelog, B.Transportes, Mengue), BRASPRESS, RODONAVES, ATUAL_CARGAS, SAO_MIGUEL, SENIOR/tck (TRD)
- `recipientCnpj` estava null (453 pedidos) → backfill executado via `/api/bling/backfill-recipient-cnpj`
- Bug corrigido: campo era `destinatario.numeroDocumento` (inexistente na listagem) — corrigido para `contato.numeroDocumento`

### Filtros e importação
- Filtro padrão de pedidos trocado de `shippedAt` para `nfIssuedAt` (pedidos novos aparecem mesmo sem rastreio)
- Bling sync corrigido: só importa NFs de transportadoras com `trackingSystem != NONE`

### Portal do cliente
- `recipientCnpj` populado — clientes conseguem buscar por CPF/CNPJ
- Visual alinhado ao modal "ver detalhes" do admin

### Notificações WhatsApp + Email
- Baileys (sem Chromium) integrado com 2 instâncias: AVIC e AGRO
- Sessão salva no banco (backup dos arquivos do Baileys) — sobrevive a restarts
- Número do celular: usar formato SEM o 9 extra (ex: `554991885757`, não `5549991885757`)
- Gmail fallback via Resend (`no-reply@avicswine.com.br` — domínio verificado)
- Templates: despacho, atualização, mesmo dia ("Oi eu novamente"), entregue 🎉
- Formatação automática do texto: "CÓDIGO - Descrição"
- Página /logs: histórico de todas as notificações enviadas
- Endpoints de teste: `POST /api/whatsapp/testar-notificacao`, `POST /api/whatsapp/simular-sequencia`

### Variáveis Railway necessárias
| Variável | Valor |
|---|---|
| `RESEND_API_KEY` | re_xxxx... |
| `EMAIL_FROM` | no-reply@avicswine.com.br |
| `PORTAL_URL` | https://order-tracker-production-4189.up.railway.app/portal/ |

### Senha admin
- `admin@avicswine.com.br` tem senha `temp_diag_2026` (alterada para diagnóstico) — redefinir

## Pendências para próxima sessão

### Em aberto
1. **AGRO-003126 (Rodonaves)** — "Atualização de entrega Bragança Paulista" — ainda em trânsito, acompanhar
2. **AVIC-009036 (São Miguel)** — "Chegou na unidade de destino, em conferência" — ainda em trânsito, acompanhar
3. **AVIC-009246 (TRD)** — sem dados na API Senior (PENDING) — mesma situação de EQUI-000019 e 000067

### Transportadoras sem rastreio (ficam PENDING permanentemente)
- B. TRANSPORTES LTDA — botão RASTREIO aponta para portal Bauer Express
- Expresso Leomar Ltda — botão RASTREIO aponta para portal Leomar
- MENGUE EXPRESS — botão RASTREIO aponta para portal Coopex/Mengue
- AZURELOG (parcialmente — SSW retorna "Informação não disponível")
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
