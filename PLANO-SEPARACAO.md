# Plano — Módulo de Separação por Bipe

Criado em 2026-08-18. Objetivo: zerar envio de peça errada / quantidade errada obrigando o bipe do SKU na separação.

## Estado da implementação (2026-08-18)

**EM PRODUÇÃO desde 2026-08-19** (`https://order-tracker-production-4189.up.railway.app/separacao`). Validado com NFs reais: sync (109 NFs/2 dias), triagem, iniciar (itens da NF, valor, série), devolver à triagem.

**Pendência do lado do Bling (José):** o app do Bling usado pelo order-tracker **não tem os escopos "Produtos" e "Canais de venda"** (403). Sem "Produtos" o módulo funciona só com os itens da NF — sem explosão de kits, fotos, peso de cadastro e catálogo de etiquetas. Para liberar: Bling → app → escopos → marcar Produtos (+ Canais de venda) → salvar → reconectar as 3 empresas no painel do order-tracker → `/separacao` → Configurações → "Testar permissões". Enquanto isso, os nomes dos canais podem ser digitados em Configurações (ID da loja → nome; ex.: 204387953).

| Fase | Estado | Observações |
|---|---|---|
| 1 Base (Prisma, `blingGet` + lock, router, app Vite, login PIN) | ✅ | Primeiro acesso cria o supervisor inicial (tela de setup) |
| 2 Fila a partir das NFs + itens + kits | ✅ | Testado com mock; adapter real segue a spec OpenAPI do Bling |
| 3 Separação no celular | ✅ | Câmera: BarcodeDetector (Chrome Android) com fallback jsQR (iPhone/Safari, só QR); campo p/ leitor Bluetooth; som/voz/vibração (iOS não vibra); qtd digitada acima do limite; zerar item |
| 4 Balcão (triagem, fila, conferir/finalizar) | ✅ | Balança via Web Serial pronta, desligada por padrão (`balancaAtiva`) |
| 5 Painel SSE | ✅ | Aba "Fila do dia" do balcão |
| 6 Etiquetas QR | ✅ | Impressão pelo navegador. Papéis: A4 ou **Zebra 10×15 cm** (4 etiquetas de 90×30 mm por página). Abas: **Pendentes do dia** (SKUs das NFs sem etiqueta impressa), **Por NF** (digita/bipa a NF, já seleciona o que falta) e **Catálogo completo**. Registro do que já foi impresso em `separacao_etiquetas` |
| 6b Triagem | ✅ | Calendário De/Até (padrão hoje) + atalhos hoje/ontem/7 dias; colunas de valor, data-hora e nº de itens; botão **📋 Itens** (estrutura da NF com kits explodidos) e **🏷 Etiquetas** (abre no papel Zebra com preview). Busca por número: o filtro `numero` do Bling não responde nessa conta → fallback varre ~4 meses em blocos (~10 s) |
| 7 Integração (Sidebar, build raiz, static, `iniciar.bat`) | ✅ | Porta dev **5176** (5175 já era do BI) |
| 8 Deploy | ✅ 2026-08-19 | Commits 08d1efb, 4a38bff, 3f7c7f8. Supervisor inicial "José" criado em produção |

### Regras de bipe (poka-yoke) — como está hoje
- **Item selecionado**: tocar num item da lista trava a seleção; outro SKU da NF → aviso **laranja** "não é o selecionado". SKU fora da NF → **vermelho** "item errado".
- **Quantidade digitada**: só liberada depois de ao menos 1 bipe do QR daquele item (regra também no servidor), e só para itens acima do limite (`limiteBipeUnitario`, padrão 5). Se a quantidade digitada não bater com a esperada, recusa.
- **DANFE bipada na tela de itens**: reconhecida (chave de 44 dígitos, QR com `|` ou URL) → aviso laranja "isso é a nota", sem contar como erro.
- **SKU virtual `BASE.N`** (ex.: `RL040.15` = 15 × `RL040`): quando o produto não tem composição no Bling e o `BASE` existe, explode automaticamente. A prateleira só precisa do QR do `BASE`.
- **Abrir NF**: aceita nº da NF, código de barras da chave (Code128, 44 dígitos) e QR da DANFE.

### Como abrir a NF na separação (3 caminhos)
1. **Digitar o nº da NF** — sempre funciona.
2. **Bipar pela câmera** — QR ou código de barras. A chave da DANFE é um Code128 de 44 dígitos (barras finas): o leitor pede Full HD e oferece lanterna e zoom, mas na prática **não decodifica** em etiqueta térmica pequena.
3. **📸 Fotografar a etiqueta (OCR)** — caminho recomendado quando o código de barras não lê. Usa a câmera nativa do celular, envia a foto (reduzida para 1600 px) e o servidor lê os números impressos com Tesseract: extrai a chave de 44 dígitos ou o "Nº NFe". Endpoint `POST /tarefas/ler-danfe` (limite de corpo de 12 MB configurado no `server.ts` **antes** do parser global). Validado em produção: ~1 s por foto.

### Como rodar local
- `iniciar.bat` (sobe backend, painel, portal e `separacao/` em modo celular/HTTPS) — ou `cd separacao && npm run dev` (http, só PC).
- Backend local usa `SEPARACAO_MOCK=1` no `backend/.env` → dados de exemplo (NFs 9101/9102/9103 Avic, 3301 Agro; SKUs VENT-40, FIX-M6, PAR-M6…). Remova a linha para usar o Bling real (exige tokens no banco local — hoje não há).
- Celular na mesma Wi-Fi: `https://<IP-do-PC>:5176/separacao` (aceitar o certificado uma vez).
- Login de teste local: José / 1234 (só existe no banco local).

### Checklist de deploy (fase 8)
1. `git add` de: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20260818*`, `backend/src/{routes/separacao,services/separacao,middleware/requireOperador.ts}`, `backend/src/routes/bling.ts`, `backend/src/server.ts`, `backend/.env.example`, `separacao/` (sem `node_modules`/`dist`), `frontend/src/components/layout/Sidebar.tsx`, `package.json` (raiz), `iniciar.bat`, `PLANO-SEPARACAO.md`, `STATUS.md`.
2. **Não** commitar `backend/.env`. No Railway **não** definir `SEPARACAO_MOCK` (ausente = Bling real). Nenhuma variável nova é necessária.
3. Push → Railway builda (`separacao/` entra no `npm run build` da raiz) e o `npm start` aplica as 2 migrations.
4. Abrir `https://<railway>/separacao` → tela de setup → criar o supervisor (Jeovan/José) → Operadores → cadastrar separadores.
5. Balcão → Triagem → "Buscar NFs agora": confere se as NFs do dia aparecem (validação do adapter real: itens, kits, canal). Se algo vier vazio, ver logs `[Separação]` no Railway.
6. Etiquetas → imprimir QR das prateleiras. Depois, celular → Separar.
7. Quando a balança chegar: Config → "Ativar conferência de peso"; Conferir → "Conectar balança" (Chrome no PC; ajustar baud/parser em `separacao/src/lib/balanca.ts` se o modelo exigir).

## Princípios

- **Isolado dentro do order-tracker**: pastas, rotas, tabelas e app Vite próprios. O order-tracker só ganha um botão no menu que abre `/separacao`.
- **Desenvolvimento 100% local, um único deploy no final.**
- Chave de identificação do produto: **SKU (campo `codigo` do Bling)**. Sem EAN.
- MVP primeiro; peso, foto, conferência cega ficam para fases seguintes.

## Cenário de uso (MVP)

A empresa separa **por Nota Fiscal**. A tarefa de separação nasce da NF, não da situação do pedido.

0. **Sync automático:** o módulo lê `GET /nfe` do dia no Bling (todas as NFs autorizadas) e cria uma `SeparacaoTarefa` `AGUARDANDO_TRIAGEM` por NF nova. **Não usa a tabela `Order`**: o sync do order-tracker descarta NFs sem transportadora rastreável (`bling.ts:369-375`), que são justamente as vendas de site/Mercado Livre — o público-alvo deste módulo. Frequência: a cada 2–5 min + botão "Atualizar".
0b. **Triagem (PC do balcão):** Jeovan (quem imprime as notas) vê as NFs do dia e **marca quais vão para separação** → `PENDENTE`. As não marcadas viram `IGNORADA` (ficam registradas, não reaparecem). Fase 2: opção "marcar automaticamente site + ML" se a NF/pedido expuser o canal.
1. Operador abre `https://<railway>/separacao` no celular Android e entra com nome + PIN.
2. Escolhe a tarefa na fila (ou bipa a NF/DANFE) → app busca os itens da NF no Bling, explode kits até o item físico → `EM_SEPARACAO`.
3. Lista de itens (SKU, nome, foto, qtd). Câmera lê o QR da prateleira (conteúdo = SKU).
   - SKU pertence à NF e ainda falta → **verde**, vibra, fala "separe N unidades", conta 1 unidade por bipe (acima de N configurável: 1 bipe + digita qtd).
   - SKU não é da NF ou já completo → **vermelho**, vibra, fala "item incorreto". Não passa.
4. Todos os itens completos → `SEPARADO`. Operador leva ao balcão.
5. **Balcão (PC):** bipa a NF → vê o resultado (itens, bipes, quem separou, horários) → **Finalizar** → `CONCLUIDO`. No MVP nada é escrito no Bling; o registro fica no app. (Fase 2: conferência cega aqui, e opcionalmente mudar situação no Bling.)
6. O PC também mostra a fila do dia com progresso em tempo real e imprime etiquetas QR.

Estados: `AGUARDANDO_TRIAGEM → PENDENTE → EM_SEPARACAO → SEPARADO → CONCLUIDO` (+ `IGNORADA` na triagem, `CANCELADA` se a NF for cancelada).

## Estrutura de arquivos

```
order-tracker/
├─ separacao/                         # app Vite novo (espelha customer-portal/)
│  ├─ vite.config.ts                  # base '/separacao', porta 5176, proxy /api → 3001
│  └─ src/
│     ├─ pages/  Login, Fila, Separar (celular), Painel (PC), Etiquetas
│     ├─ components/  Scanner (câmera), ItemCard, Feedback (som/voz/vibração)
│     └─ lib/api.ts, auth.ts
├─ backend/src/
│  ├─ routes/separacao.ts             # router isolado, prefixo /api/separacao
│  ├─ services/separacao/
│  │  ├─ bling-pedidos.ts             # buscar pedido por NF, explodir kits, catálogo, mudar situação
│  │  ├─ estado.ts                    # regras: iniciar, bipar, concluir
│  │  └─ auth-operador.ts             # login nome+PIN, JWT próprio (kind: 'operador')
│  └─ middleware/requireOperador.ts
└─ backend/prisma/schema.prisma       # models novos com prefixo Separacao*
```

Mudanças fora do módulo (mínimas):
- `backend/src/routes/bling.ts`: exportar `blingGet`; adicionar lock de refresh por empresa (`Map<companyKey, Promise>`).
- `backend/src/server.ts`: `app.use('/api/separacao', separacaoRouter)` + `express.static` e catch-all `/separacao/*` (antes do catch-all do frontend).
- `package.json` raiz: incluir build do `separacao/`.
- `frontend/src/components/layout/Sidebar.tsx`: link externo "Separação" → `/separacao`.
- `iniciar.bat`: subir o `separacao/` (porta 5176).

## Modelo de dados (Prisma)

```prisma
model SeparacaoOperador   { id, nome, pin (hash), ativo, createdAt }            @@map("separacao_operadores")
model SeparacaoTarefa     { id, companyKey, blingNfId (unique com companyKey), nfNumero, clienteNome, canal?,
                            orderId? (FK Order opcional — só quando o order-tracker também tiver a NF),
                            status (AGUARDANDO_TRIAGEM|PENDENTE|IGNORADA|EM_SEPARACAO|SEPARADO|CONCLUIDO|CANCELADA),
                            triadoPorId?, triadoEm?, operadorId?, iniciadoEm?, separadoEm?, concluidoEm?, finalizadoPorId?, itensCarregados }
                                                                                 @@map("separacao_tarefas")
model SeparacaoItem       { id, tarefaId, sku, nome, fotoUrl?, origemKit? (texto),
                            qtdEsperada, qtdBipada, concluidoEm? }              @@map("separacao_itens")
model SeparacaoEvento     { id, tarefaId, operadorId, sku?, tipo (INICIO|BIPE_OK|BIPE_ERRADO|BIPE_EXCEDENTE|
                            QTD_MANUAL|SEPARADO|FINALIZADO), criadoEm }          @@map("separacao_eventos")
model SeparacaoConfig     { id, chave, valor }  // limiteBipeUnitario, intervaloSyncMin, etc.
```
A tarefa é independente do `Order` (a maioria das NFs de e-commerce não existe lá). Itens só são carregados do Bling quando a tarefa é iniciada (evita chamadas desnecessárias).
`SeparacaoEvento` é a base das métricas futuras (erro por SKU/operador).

## Endpoints (`/api/separacao`)

| Método | Rota | Função |
|---|---|---|
| POST | `/login` | nome + PIN → JWT operador |
| GET | `/tarefas?empresa=&status=&data=` | fila (tarefas do dia por status) |
| POST | `/tarefas/sync` | sync leve: NFs do dia no Bling → cria tarefas AGUARDANDO_TRIAGEM novas (também roda no cron a cada N min) |
| POST | `/tarefas/triagem` | body `{ids, acao: 'separar'|'ignorar'}` → PENDENTE ou IGNORADA (registra quem triou) |
| GET | `/tarefas/por-nf/:nf?empresa=` | localizar tarefa bipando a DANFE |
| POST | `/tarefas/:id/iniciar` | busca itens da NF no Bling, explode kits, grava itens → EM_SEPARACAO |
| GET | `/tarefas/:id` | estado atual (itens, progresso, eventos) |
| POST | `/tarefas/:id/bipar` | body `{sku, qtd?}` → valida, atualiza `qtdBipada`, grava evento, retorna verde/vermelho + motivo |
| POST | `/tarefas/:id/separado` | valida tudo completo → SEPARADO |
| POST | `/tarefas/:id/finalizar` | balcão: → CONCLUIDO (registra quem finalizou) |
| GET | `/tarefas/stream` | SSE da fila para o painel do PC (padrão já existe no projeto) |
| GET | `/catalogo?empresa=&busca=` | produtos (id, sku, nome) para etiquetas |
| GET | `/etiquetas.pdf?skus=` | PDF de etiquetas QR (conteúdo = SKU) |
| GET/PUT | `/config` | limite de bipe unitário, intervalo do sync |

Chamadas novas ao Bling (via `blingGet`): `GET /nfe?dataEmissaoInicial=hoje` (já usado no sync), `GET /nfe/:id` (itens da NF: SKU, descrição, quantidade), `GET /produtos?codigo=SKU` (id + estrutura de kit + foto), `GET /produtos/:id` (componentes do kit, recursivo), `GET /produtos` (catálogo p/ etiquetas). **Nenhuma escrita no Bling no MVP.**

## Fases de implementação (todas locais)

1. **Base** — Prisma models + migration; exportar `blingGet` + lock de refresh; router vazio registrado; app Vite `separacao/` com login nome+PIN.
2. **Fila a partir das NFs** — sync próprio (`GET /nfe` do dia, todas as empresas) cria tarefa PENDENTE por NF nova; itens da NF via `/nfe/:id`; explosão recursiva de kits via `/produtos` (cache de produto, proteção contra ciclo); verificar se dá para identificar canal (site/ML/balcão) para filtro. Testar com NFs reais (só leitura).
3. **Separação no celular** — fila, tela de itens, leitor QR (BarcodeDetector com fallback jsQR), regra de bipe, feedback som/voz/vibração, contagem por unidade / qtd manual acima do limite, marcar SEPARADO.
4. **Balcão (PC)** — tela de triagem (marcar NFs para separação / ignorar); bipar NF → resumo da separação → Finalizar (CONCLUIDO); tela de config (limite, intervalo).
4b. **Pesagem no balcão** (logo após o núcleo; entra no mesmo deploy se a balança já estiver definida) — itens com qtd digitada (acima do limite de bipe) ficam marcados "conferir peso"; no balcão, balança via Web Serial (Chrome) → `peso lido` vs `pesoUnit (Bling) × qtd` com tolerância % → verde/vermelho; Finalizar só libera com todos ok (ou liberação por PIN de supervisor, registrada). Pré-requisitos: peso unitário preenchido no Bling (app lista SKUs sem peso) e balança com resolução adequada + saída serial/USB. Depois: pesar caixa fechada vs soma total.
5. **Painel PC** — fila do dia com progresso via SSE.
6. **Etiquetas** — catálogo, seleção, PDF com QR do SKU. **Restrição: altura máxima 4 cm** (layout horizontal: QR ~3 cm + SKU/nome em texto ao lado; largura/altura/margens configuráveis; padrão A4 com grade).
7. **Integração final** — botão no Sidebar, build no `package.json` raiz, static/catch-all no `server.ts`, `iniciar.bat`.
8. **Deploy único** — push → Railway roda `prisma migrate deploy` no start. Autorizar nada de novo no Bling (tokens já existem).

## Desenvolvimento local — cuidados

- **Câmera no celular exige HTTPS.** Em dev, o `separacao/vite.config.ts` usa `@vitejs/plugin-basic-ssl` com `server.host = true` → celular abre `https://<IP-do-PC>:5176/separacao` (aceita o aviso do certificado uma vez). Alternativa: testar o fluxo digitando o SKU no campo (o leitor Bluetooth entra pelo mesmo campo).
- **Token do Bling compartilhado com o Railway.** O backend local usa o mesmo banco/tokens da produção; o refresh é rotativo. Regras durante o dev: (1) implementar o lock de refresh na fase 1; (2) para desenvolver telas, usar fixtures JSON de pedido/produto (`SEPARACAO_MOCK=1`) e só bater no Bling real nos testes de integração; (3) nunca rodar dois backends locais ao mesmo tempo.
- **Rate limit global** (300 req/min por IP): bipes são rápidos, mas o `/bipar` é 1 requisição por bipe — ok para o MVP; se estourar, limiter próprio no router.
- **Sem escrever no Bling durante o dev**, exceto o teste final de `PATCH situação` em um pedido de teste.

## Fora do MVP (fases seguintes)

- Conferência cega na bancada (2ª bipagem sem ver a lista)
- Etiqueta por unidade nos SKUs "gêmeos"; alerta de similares
- Foto da caixa (getUserMedia) no PC; pesagem da caixa fechada
- Endereçamento de prateleira; ordenação por rota
- Painel de indicadores (erros por SKU/operador/dia)
- Leitor Bluetooth pareado ao celular (funciona sem mudança no app)

## Decisões pendentes de José

- Limite para bipe unitário (sugestão: até 5 unidades)
- Intervalo do sync leve de NFs do dia (sugestão: 3 min)
- Impressora de etiquetas: A4 comum (início) ou térmica (modelo?)
- Ao finalizar no balcão: só registrar no app (MVP) — confirmar que não precisa mexer no Bling
- Balança: modelo, capacidade, divisão, saída serial/USB? Pesos unitários preenchidos no Bling?
