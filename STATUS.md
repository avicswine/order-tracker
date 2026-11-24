# STATUS — Order Tracker

Última atualização: 2026-11-24 (DIFAL: ML volta a pagar envio pelo ML, arquivo de pagamento Sicredi, usuário Financeiro; nota nas vendas ML "combinar entrega"; link do rastreio na mensagem do ML — PRs #35 a #43, em produção)

## Regra de trabalho (definida por José em 2026-11-07)

**Toda recomendação ou apontamento de mudança vem com a FONTE** — link, cláusula,
`arquivo:linha` ou a consulta de onde o dado saiu. Sem a fonte lida, dizer explicitamente
que é inferência, nunca apresentar como fato. O motivo: na sessão de 07/11 três
afirmações minhas sobre políticas do ML caíram quando a fonte foi cobrada, gerando
retrabalho e custo.

## Sessão 23–24/11/2026 (PRs #35 a #43, tudo em produção)

- **#35 Link do rastreio na mensagem de despacho do ML** (decisão do José: é o nosso próprio rastreio). Texto em
  `RASTREIO_ML` (`backend/src/services/notifier.ts`), mesmo endereço do WhatsApp/e-mail (`PORTAL_URL`).
- **#36/#38 Dica do cálculo do DIFAL fora da tela:** causa era a animação de entrada com `both` deixando `transform`
  preso (vira bloco de referência para `position: fixed`); agora `backwards` (`componentes.css`).
- **#37 Estados com cobrança:** + BA, MS, MT, SE (`UFS_COM_COBRANCA` em `guias.ts`).
- **#39 Usuário Financeiro** (papel `FINANCEIRO`): só a aba DIFAL, sem a engrenagem; o servidor barra o resto
  (`middleware/auth.ts`) e a configuração rota a rota (`negarAoFinanceiro`). Victoria: `ricacapitalgrupo@gmail.com`
  (senha entregue por arquivo local `.env.acesso-victoria`, a apagar). O `financeiro@avicswine.com.br` já existia como
  Administrador e foi mantido.
- **#40 DIFAL do ML — decisão do José (23/11), desfaz a de 20/11:** venda do ML com **envio pelo ML** (Coleta, FULL,
  Flex, Agência) **o ML paga**; nós só conferimos no Fechamento ML. **"A combinar" e ME1 a guia é nossa.** Tipo de
  envio não lido/estranho = "confirmar antes de gerar" (lista positiva `LOGISTICAS_ML_NOSSAS`). As do ML aparecem só
  com "Ver Mercado Livre". Vendas: listas **Para emitir / Emitidas: pagar e anexar / Atrasadas**, filtro AVIC/AGRO,
  filtro no cabeçalho (estilo Excel), linhas mais baixas, "Copiar link do ML".
- **#41/#42 Nota na venda ML "combinar entrega"** (`NF · transportadora · status · entrega`): atualizada no fim de
  cada rodada de rastreio só quando o texto muda (`services/notasCombinarEntrega.ts`, campo `orders.mlNotaTexto`).
  Não apaga nota escrita à mão (só troca a nossa ou a "Previsão de entrega"); falha espera 24h fora da fila.
  `ML_NOTAS_POR_RODADA=20` no Railway. 24/11: 12 notas gravadas (11 criadas/alteradas, 1 mantida — AGRO 6390).
- **#43 Arquivo de pagamento Sicredi (CNAB 240)**, botão "Arquivo Sicredi" em DIFAL → O que já pagamos.
  Manual Sicredi "Pagamento a Fornecedor" v1.5 (07/2026); tributo com código de barras = serviço 22, forma 11,
  segmento O. Convênio **AVIC 7SR1 / AGRO 7SR3**; conta nas variáveis `SICREDI_<EMP>_AGENCIA/_CONTA/_CONTA_DV` do
  Railway (não estão no código). Valor = o da guia emitida pelo portal. "Tirar do arquivo" e baixar de novo.
  Conferência: `npx tsx src/services/difal/verificarCnabSicredi.ts` (25 casos).
- **Rodadas de rastreio:** o cron `0 */2 * * *` roda em UTC → **horas ímpares de Brasília** (9h, 11h…). O botão
  "Atualizar rastreamento" dispara duas rodadas (geral + São Miguel); duas rodadas juntas estouram o login da
  Atual Cargas (429).

## Padronização visual (22/11/2026, PR #33, em produção)

Todo o painel e o Portal Cliente com a mesma cara. Só visual: nenhuma rota, API, regra ou permissão mudou.

- **Onde mexer no visual** (um lugar só, painel e Portal leem daqui):
  - `frontend/tailwind.tema.js`: cores (primária azul petróleo `#0E5A6B`, grafite `#1E293B`), 3 sombras, fonte do
    sistema, transição de 150 ms.
  - `frontend/src/componentes.css`: botões (`btn-primary`, `btn-secondary`, `btn-outline`, `btn-danger`, `btn-ghost`,
    `btn-sm`), campos (`input`, `label`, `checkbox`), `card`, `resumo-*`, `tabela` (cabeçalho fixo, zebra, `num` à
    direita), `selo`, `abas`/`aba`, `segmentos`, `alerta-*`, `estado-vazio`/`estado-carregando`, `janela`, `linha-tempo`.
  - `frontend/src/lib/estilo.ts`: tons dos selos e a cor de cada status de pedido.
- **Cores de status** (iguais em todas as telas e no Portal): Faturado âmbar · Em trânsito azul · Entregue verde ·
  Entregue c/ ocorrência âmbar forte · Ocorrência vermelho · Atrasado laranja · Cancelado **cinza**.
- **R$ e datas** sempre `R$ 1.234,56`, `21/11/2026`, `21/11/2026 às 14:30` (`formatBRL`, `formatDate`, `formatDateTime`
  em `frontend/src/lib/utils.ts`). A data da nota no DIFAL continua lida em UTC (`dataBr`).
- **Celular:** menu lateral escondido, abre pelo botão ☰ (fecha tocando fora, com Esc ou escolhendo a página).
- **DIFAL:** saiu o visual "futurista" (`difal.css` apagado); usa os componentes padrão.
- **Separação:** link escondido do menu (app sem uso por enquanto); continua em `/separacao`. O app de Separação
  **não** foi padronizado (fonte grande e botões altos de propósito para o galpão).
- **Teste local:** usuários de teste só no banco do PC (Administrador e Visualizador), criados por
  `backend/src/_usuarios_teste_local.ts` (não versionado); senhas em `backend/.env.usuarios-teste` (ignorado pelo git).

## Monitor de DIFAL — ESTADO ATUAL (2026-11-20, tudo na `main` e em produção)

PRs mergeados: #2 a #22 (monitor, portal GNRE, formato do lote até a guia ser aceita, visual), #23 (base pelo valor da
NF, pagar no dia da emissão, rotina diária, abas novas, registro de guias pagas), #24 (filtro por canal, lote só com as
notas visíveis), #25 (leitura do DIFAL pago para o cmvsync), #26 (engrenagem e cabeçalho), #27 (topo compacto,
Fechamento ML com todos os meses, histórico da AGRO). cmvsync: PR #3 (DIFAL pago nas Vendas).

### Em produção desde 20/11/2026

- **Portal GNRE em PRODUÇÃO** (`GNRE_AMBIENTE=producao`; AVIC 47.715.256/0001-49 e AGRO 54.695.386/0001-22
  autorizadas pelo portal). **Primeira guia real:** AGRO NF 6541 (CE), R$ 8,29, lote `AGRO-20261120235417-TPIY`,
  processada, pagar em **23/11/2026**. A guia em PDF é o modelo oficial gerado pelo próprio portal.
- **Regras de dinheiro** (decisões do José):
  - Base do DIFAL = **valor total da NF** (já com desconto, frete, outras despesas e IPI), repartida entre itens
    8436 e demais na proporção dos produtos (LC 87/96, art. 13). Notas em aberto recalculadas no Railway em 20/11
    (`backend/src/_recalcula_base_nf.ts`, com backup); 92 notas mudaram, −R$ 218,06.
  - **Todo DIFAL vence no dia da emissão da NF, de qualquer canal** (sem separar "o ML paga"). Nota emitida a partir
    das **17h**, ou em fim de semana/feriado, vence no próximo dia útil (`prazoDoDifal` em `guias.ts`).
    Vendas do ML dos últimos **30 dias** entram na lista.
  - Nota com guia gerada nunca tem o valor reescrito (nem numa nova leitura do Bling).
  - Marcar como paga: só guia aceita pelo portal em produção.
- **Rotina diária** às **16h** (dias úteis), resumo no WhatsApp da AVIC: **DESLIGADA** até criar no Railway
  `DIFAL_ROTINA=1` e `DIFAL_WHATSAPP_NUMERO`. `DIFAL_ROTINA_ENVIAR=1` também gera/envia lotes (só age em produção).
  Lista à parte as notas que venceram no último dia útil e seguem sem guia (emitidas entre 16h e 17h).
- **Tela `/difal`:** cabeçalho numa linha com a engrenagem (Configuração); cards (guias a emitir, valor das notas e
  DIFAL médio %, cobrança do ML divergente) acima das abas e seguindo os filtros; abas Vendas · Lotes GNRE ·
  O que já pagamos · Fechamento ML; barra de filtros (No prazo | Atrasadas, busca, canal, datas, estados com cobrança,
  ↻ Bling); colunas de envio iguais à tela de Pedidos; Valor da NF; dicas com itens e a conta do DIFAL.
- **cmvsync:** painel de Vendas mostra o DIFAL **só nas vendas com guia paga** e desconta do lucro. Lê
  `GET /api/difal-externo/pagas` com a chave `DIFAL_CHAVE_CMVSYNC` (igual no Railway e no `.env` do cmvsync).

### Histórico das guias pagas pelo ML (ZIPs de comprovantes)

- ZIPs em `Downloads\DIFAL-comprovantes\AVIC` e `\AGRO` (`EMPRESA-AAAA-MM.zip`). **O ML baixa os arquivos das duas
  empresas com o mesmo nome:** salvar com o nome da empresa (um sobrescreveu o outro em out/2026).
- Dados no repositório: `backend/src/services/difal/dados/historico-guias.json` (AVIC) e `historico-guias-agro.json`.
  Comparação só com notas 100% NCM 8436; autuações (PI) à parte. Correções de leitura: DAE/CE com o principal no
  campo da multa; DAR/AL e PI com multa/juros pela diferença do total; 8 guias da AGRO (TO/AM/PB) estimadas pelo
  valor do nome do arquivo.
- **Dez/2025 a 20/11/2026:** ML pagou **R$ 20.712,42**, devido **R$ 5.604,71**, **pago a mais R$ 15.107,71**
  (AVIC R$ 9.084,43 · AGRO R$ 6.023,28), multa/juros R$ 1.539,86.
- Planilha para pedir restituição (por empresa e estado): `Downloads\DIFAL-comprovantes\DIFAL-restituicao-por-estado.xlsx`.
  Base: CTN arts. 165, 166 (provar que arcamos com o encargo: o ML cobrou de nós pelo CDIFAL) e 168 (5 anos).

### Como trabalhar (decisão do José, 20/11/2026)

**Desenvolver e testar no PC; Railway só depois de pronto (PR + revisão por agente separado + "pode" do José).**
- Banco local com as tabelas `difal_*` copiadas da produção (`backend/src/_copia_difal_local.ts`, não versionado).
  O PC fica em homologação no portal GNRE; o José testa a produção em rastreio.avicswine.com.br.
- **Nunca usar no PC os tokens do Bling/ML de produção.** Scripts que só leem produção usam a `DATABASE_PUBLIC_URL`
  do serviço Postgres-PsBX.
- Subir: backend `npm run dev` (3001) e frontend `npx vite --port 5174`; abrir http://localhost:5174.
- Conferência: `npx tsx src/services/difal/verificar.ts` (15 casos: valor e prazo), `verificarGnre.ts`,
  `verificarPortalGnre.ts`; no cmvsync, `python -m pytest -q tests`.

### O que falta (em ordem)

1. **Arquivo Sicredi:** José dá o ok no sininho do app Sicredi (cada conta) e faz o **primeiro teste com 1 guia**
   (subir o `.REM`, conferir valor/vencimento/beneficiário, aprovar). Depois: ler o retorno `.RET` para marcar "paga".
2. **Fim de nov/2026:** José baixa os ZIPs restantes de novembro (AVIC e AGRO, nomes separados) → conferir se as guias
   de NFs emitidas **depois de 16/11** (regras fiscais dos anúncios corrigidas) saíram com o devido (1,5%; CE 3,64%)
   e **duplicidade**: 13 guias de vendas ML (AGRO, R$ 630,38) foram geradas e pagas em 23/11 antes da volta ao
   "ML paga". Suspeita de dobro (ML também recolheu): 6464, 6467, 6471, 6473, 6474, 6475, 6477, 6478, 6496, 6534
   (R$ 370,83); 6492 depende do comprovante; 6474 com envio **cancelado** no ML; 6512 é Shopee (ver se a Shopee
   recolhe); 6360 e 6515 são "A combinar" (guia nossa, sem dobro).
3. **Contabilidade:** pedidos de restituição por estado (planilha); atrasadas (multa/juros); regra "dia 15" só vale
   com inscrição estadual no destino (Convênio ICMS 236/21, cláusula sexta); cálculo "por dentro" (LC 87/96, art. 13,
   § 1º, I) no DIFAL com redução; categoria de "produto" do MA.
4. Ligar a rotina diária (variáveis no Railway) quando o José passar o número do WhatsApp.
5. cmvsync no PC: a pasta está na branch `fix-historico-cliente-perguntas` (outra tarefa); o DIFAL nas Vendas aparece
   quando ela voltar para a `main`.
6. Venda de balcão no cmvsync (sem número de pedido na loja): ligar ao DIFAL numa segunda etapa.
7. Certificados A1: **AVIC vence 15/01/2027**, AGRO 09/06/2027.
8. Lote GNRE: a tela mostra "gerado em" no horário UTC (um dia a mais à noite) — só exibição.

## Rastreio da Frenet (J&T e Correios) — EM ANDAMENTO (24/11/2026)

- A conta Frenet (`FRENET_TOKEN` no `.env` do PC; Chave/Senha/Token em Chaves de acesso do painel) **rastreia pelo
  código**: `POST api.frenet.com.br/tracking/trackinginfo` com `ShippingServiceCode` (J&T Standard = `JTE_INT`,
  PAC = `03298`, Sedex = `03220`). Testado com 888031064908419: histórico completo.
- **Falta o código de cada NF:** não volta para o Bling; a lista de envios (`GET whitelabel…/v1/shipments`) exige
  `x-partner-token`. A Frenet pediu nome da empresa, e-mail da conta e motivo; o José vai responder. Quando vier,
  cadastrar `FRENET_PARTNER_TOKEN` no Railway.
- Especificação aprovada: J&T ("J&T EXPRESS BRAZIL LTDA.", hoje NONE, 106 NFs ignoradas) e Correios pela Frenet
  (provável "LITHIUM SOFTWARE LTDA" = Frenet, 18 NFs ignoradas — confirmar); campo de código de rastreio no pedido;
  os 30 envios colados pelo José (lista no scratch da sessão) entram **sem aviso retroativo** ao cliente.
  Worktree `../order-tracker-frenet` criada, sem código ainda.

## Pendências fora do DIFAL (24/11/2026)

- **Rastreio com erro na rodada de 24/11:** TRD Dalfan/Senior (15 NFs, 403/timeout do portal), Atual Cargas Cajamar
  (2 NFs, CNPJ sem login configurado), Braspress (5, site não respondeu).
- **Endereços `rastreio.avicswine` / `rastreio.agrogranja`** para o link do portal: falta saber se a Agrogranja tem
  domínio e acesso ao DNS.

### Regras aprendidas na planilha fiscal do ML (16–17/11/2026)

- Subir **Regras Tributárias antes** dos Dados Fiscais (senão "Regra Fiscal inválida").
- NCM nunca vai sem regra; "Código do produto" = SKU do Bling; um SKU pode estar em vários anúncios.
- Aba Kits: "Preço do item no kit" é percentual (100); a aba **não aceita** Regra tributária.
- Regras de Transferência/Remessa nas 4 regras (AVIC 821700/821701, AGRO 828518/828519): CST 41 + PIS/COFINS CST 49, padrão da granja.

### Portal GNRE — regras que custaram tentativas (manual v2.17 + XSD + GnreConfigUF)

Resposta do envio é `processarResponse`; `identificadorGuia` só dígitos (número da NF); textos ≤ 60 caracteres latinos;
documento de origem no tipo que a UF aceita (10 número, 22 chave NF-e, 24 chave DF-e, nenhum em MS/PB);
`dataPagamento` obrigatória; emitente só com CNPJ (IE só se inscrito na UF, regra 202); campos extras por UF;
cadeia ICP-Brasil embutida (`dados/cadeiaIcpBrasilRfb.ts`); `emitidaEm` guarda Brasília como se fosse UTC.

---

## Módulo de DIFAL — ESPECIFICAÇÃO ORIGINAL (2026-11-16)

Controle do ICMS-DIFAL das vendas interestaduais para consumidor final **não contribuinte**:
conferir se o valor recolhido bate com o que a regra manda, e acompanhar multa e juros.

### Decisões tomadas por José

| decisão | escolha |
|---|---|
| Onde mora | order-tracker (Railway, Postgres) |
| Acesso da Victória | papel novo `FISCAL` no login existente — vê só as telas de DIFAL |
| Aviso automático | nenhum por ora; ela olha o painel. Rever se ela pedir |
| PDFs | **não** são guardados. Só os valores lidos; originais ficam no OneDrive do José |
| Redução de base | NCM com prefixo **8436** tem redução; o resto não |

Para permitir mudar os PDFs para o Railway depois sem retrabalho, cada guia e comprovante
guarda `zip_nome`, `caminho_no_zip` e `arquivo_hash`. A migração vira uma reimportação dos
mesmos ZIPs, sem remexer no que já foi lido.

**Consequência aceita:** a tela não mostra o PDF, só diz onde ele está no OneDrive.
Pendente confirmar com a Victória se ela tem acesso à mesma pasta.

### A regra de cálculo (da calculadora interna, revisada em 05/11/2026)

Origem RS, consumidor final sem Inscrição Estadual. Base: Convênio ICMS 52/91 (Anexo II),
153/15, 236/21 e LC 190/2022.

```
carga interna do destino: 5,6%
carga de origem: importado 4%  ·  interestadual 7% → 4,1%  ·  interestadual 12% → 7%

método "carga" (maioria):      DIFAL = valor × (5,6% − carga de origem)
método "prop" (CE, MT, PE):    DIFAL = valor × (5,6 ÷ alíq. interna) × (alíq. interna − inter)
```

Resultado prático:

| destino | alíq. interestadual | DIFAL esperado |
|---|---|---|
| MG, PR, RJ, SC, SP | 12% | **zero** (carga de origem 7% já passa de 5,6%) |
| demais estados | 7% | **1,5% do valor** |
| importado | 4% | 1,6% do valor |

Só **6 estados** têm posição do fisco ou da contabilidade (CE, MG, PA, PE, PI, SP). Os
outros 17 estão como "a validar" e a calculadora já traz o valor alternativo pelo outro
método — os dois ficam guardados, e divergência em estado "a validar" aparece como
*interpretação*, não como erro.

### Achados da investigação da API (2026-11-16) — mudam o desenho

1. **Não existe API do ML para guias e comprovantes de DIFAL.** Verificado em
   <https://developers.mercadolivre.com.br/pt_br/configuracao-do-calculo-do-diferencial-de-aliquota-difal>
   (só configura o modo de cálculo na tela), no `GET /processes` do
   [download em lote](https://developers.mercadolivre.com.br/pt_br/download-em-lote-de-documentos-fiscais)
   (devolve apenas `cte`, `disablement`, `invoice-arg`, `invoice-bra`, `invoice-mex`) e em
   [baixar documento legal](https://developers.mercadolivre.com.br/pt_br/baixar-documento-legal)
   (faturas do ML/MP). **O ZIP é a única fonte.**
2. **O `CDIFAL` da fatura NÃO liga a nota nenhuma.** `sales_info`, `shipping_info` e
   `items_info` vêm nulos; o único identificador é `document_info.document_id`, que é o id
   da **fatura** do ML (confirmado: 5396852020 = BILL de R$ 1.715,99 do período 23/10–23/11).
   Por isso a coluna "cobrado" da aba vem da **guia do ZIP**, que tem a chave da NF-e no nome
   da pasta. O `CDIFAL` fica só como conferência de total mensal.
3. **Suspeita em aberto:** o `CDIFAL` pode ser DIFAL do **frete**, não das vendas —
   `marketplace_info.marketplace = SHIPPING`, só 260 lançamentos em 10 meses (R$ 25.235,89
   somando AVIC e AGRO) e valores de R$ 3 a R$ 45. Confirma sozinho quando as primeiras
   guias forem lidas: se as ordens de grandeza não baterem, está respondido.
4. **O filtro `detail_sub_types` da API não funciona** — devolve zero mesmo havendo
   lançamentos. Tem que paginar e filtrar por `charge_info.detail_sub_type` na mão.
5. **Paginar por `from_id`, nunca `offset`** (teto de 10.000, a leitura para sem erro), e
   **não parar em página curta** — a API devolve menos que o `limit` mesmo havendo mais.
   Armadilhas que o cmvsync já pagou para descobrir ([ml_cobrancas.py:61](../cmvsync/ml_cobrancas.py#L61)).
6. **Convênio 52/91 vence em 31/12/2026.** O 131/2026 prorroga até 2028 mas depende de
   ratificação nacional. Precisa de aviso na tela com data.
7. **O fundo de pobreza sai em guia separada** → uma nota pode ter mais de uma guia.
8. **Rondônia exige a guia paga antes da saída** (TATE/RO negou a redução em nota sem DIFAL
   recolhido, decisão de 2026). O semáforo de RO não pode esperar o prazo.

### Tabelas

| tabela | conteúdo |
|---|---|
| `difal_notas` | chave da NF-e, número, data, UF destino, valor, NCM, `tem_reducao`, `dest_contribuinte` (do `indIEDest` do XML), origem do produto, DIFAL esperado, DIFAL alternativo, método, confiança, status |
| `difal_guias` | modelo, UF, **principal, multa, juros e atualização separados**, vencimento, linha digitável, código de receita, DIFAL ou autuação, `leitura_incerta` + campos incertos |
| `difal_comprovantes` | data do pagamento, valor, autenticação, NSU, protocolo, linha digitável, pagador |
| `difal_cobrancas_ml` | o `CDIFAL` da fatura (conferência mensal apenas) |
| `difal_zips` | nome, hash do arquivo, data, pastas lidas, erros |

### Conferências

```
1. DIFAL esperado × principal da guia   → o cálculo bate com o recolhido?
2. linha digitável da guia × do comprovante → o comprovante é dessa guia?
3. total da guia × valor pago           → pagou o valor certo?
4. CDIFAL do mês × soma das guias       → fechamento mensal (informativo)
```

A conferência 1 tem três resultados: **bate**, **diverge dentro da interpretação** (estado
"a validar", valor igual ao método alternativo) e **erro**.

### Telas

1. **Análise** — uma linha por nota: deveria ser × foi recolhido × diferença, com a multa e
   os juros abertos. Filtros por empresa, UF, mês e "só divergentes". Totalizador no topo.
2. **Notas** — lista com semáforo (paga, em aberto, vencendo, atrasada).
3. **Detalhe da nota** — as conferências lado a lado e onde achar cada PDF no OneDrive.
4. **Resumo** — por mês e UF: principal, multa, juros, dias médios até o pagamento.
5. **Importação** — upload do ZIP e histórico, com controle por hash.

### Ordem de construção

1. Importar o ZIP: ler XML, criar notas, controlar por hash (sem ler guia ainda)
2. Leitor de guia, um modelo por vez, nesta ordem: **CE, RN, PI** (83 das 108 guias),
   depois TO, AL, PB, AM
3. Leitor de comprovante, começando pelos 2 modelos maiores (Smart Online e
   "Comprovante de arrecadação" = 42 dos 60 lidos)
4. Conferências 2 e 3, e o semáforo
5. Cálculo do DIFAL esperado e a conferência 1
6. Tela de análise e o resumo
7. `CDIFAL` da fatura (informativo, por último)

### Inventário dos ZIPs reais (10 arquivos, dez/2025 a nov/2026)

José forneceu os ZIPs em `C:\Users\josef\Downloads\*Comprovantes_do_DIFAL.zip` (originais
também em `C:\Users\josef\AVIC VENTILACAO\Transferências\DIFAL`). O ZIP é exportado do
próprio Mercado Livre.

```
120 notas · ~108 guias · R$ 10.082,22 nas 98 guias que o parser leu
estrutura: <pasta do zip>/<DD de mês AAAA - Chave da NF-e {44 dígitos}>/<arquivo>
```

**Só 7 estados emitem guia por operação** — não 23 como a calculadora cobre:

| UF | guias | total | modelo do documento |
|---|---|---|---|
| CE | 43 | R$ 2.444,33 | DAE (valor dentro do código de barras — o mais trabalhoso) |
| RN | 28 | R$ 3.202,45 | GRI — Guia de Recolhimento Instantâneo |
| PI | 12 | R$ 2.306,16 | DAR com campos numerados |
| TO | 5 | R$ 1.051,03 | DARE — já traz multa, juros e atualização separados (o mais fácil) |
| AL | 5 | R$ 761,42 | DAR |
| PB | 3 | R$ 230,56 | GNRE (o único) |
| AM | 2 | R$ 86,27 | DAR |

Confirmar com a contabilidade o que acontece nos **outros estados**: não geram guia, ou o
DIFAL é recolhido de outra forma? Muda a conta do que está "em aberto".

**Comprovantes: 6 modelos**, que mudam por pagador e não por estado (60 lidos):

| modelo | qtd | identificação no texto |
|---|---|---|
| Smart Online / Online2 (Bradesco) | 21 | `DATA DE VENCIMENTO VALOR COBRADO … Smart Online` |
| Comprovante de arrecadação (sem marca) | 21 | `Comprovante de Pagamento de Guias de Arrecadação` |
| Itaú — código de barras | 8 | `Comprovante de pagamento com código de barras - SEFAZ-CE/DAE` |
| Pag Util / Itaú | 5 | `Código de Barras: SEFAZ-CE/DAE` |
| Bradesco — Tesouraria on-line | 3 | `Tesouraria on-line … SEFAZ/CE` |
| Itaú/Bradesco — agência | 2 | `Agência: 0302 … Empresa/Órgão: SEFAZ/CE` |

**Total: 13 leitores** (7 guias + 6 comprovantes). Começando pelos 2 maiores modelos de
comprovante e pelos 3 estados de maior volume (CE, RN, PI = 83 das 108 guias), a maior
parte do dinheiro fica coberta na primeira rodada.

**Nenhum PDF é escaneado** — todos têm texto extraível, então o leitor dispensa OCR.

**Quatro padrões de nome de arquivo**, todos precisam ser tratados (mas o dado confiável é
a chave de 44 dígitos no nome da pasta, não o nome do arquivo):

```
guia-de-pagamento000009358al641-5647715256000149.pdf   nota com zeros, valor com hífen
guia-de-pagamento8270ce181-9947715256000149.pdf        nota sem zeros
guia-de-pagamento-8615-ce-46-37-47715256000149.pdf     tudo com hífen
guia-de-pagamento-8606-ce-201.65-47715256000149.pdf    valor com ponto
guia-de-pagamento-9609-am-79-83-difald.pdf             sufixo "difald", sem CNPJ
```

### ACHADO FISCAL — guias em nome de pessoa física

As guias e comprovantes de **PI, AL, RN e TO** saem com o nome e CPF da sócia no campo
"Nome ou Razão Social", **não** com a AVIC e o CNPJ.

É o mesmo erro de cadastro do Mercado Livre registrado na sessão de 07/11 (razão social da
conta como "DIRLENE JOANA BAZZANELLA" em vez de "AVIC VENTILACAO E EXAUSTAO INDUSTRIAL
LTDA"). O ML emite a guia com a razão social que tem cadastrada, então **o erro está
vazando para o recolhimento de imposto**.

Duas ações, nenhuma de programação:
- perguntar à contabilidade se recolhimento em nome de pessoa física compromete o crédito
  ou gera risco de autuação;
- conferir se a correção do cadastro no ML saiu — se não saiu, todas as guias novas
  continuam erradas.

### O que falta antes de escrever código

- ~~Amostras de guia~~ — **resolvido**, os 10 ZIPs cobrem os 7 estados e os 6 modelos de
  comprovante.
- **Confirmar o acesso da Victória** à pasta do OneDrive (sem ele, ela não abre nenhum PDF
  a partir da tela).
- **Saber se existem outros NCMs** fora do 8436, para a tela mostrar os dois modos.
- **Confirmar com a contabilidade** o tratamento dos estados que não emitem guia.

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
