# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Bolso Certo — a personal finance dashboard (income/expense tracking, budgets, savings goals,
recurring bills, installments, charts, PDF/CSV reports) built as a **single self-contained HTML
file**, in Portuguese. No build step, no package manager, no framework.

- `index.html` — the live app, served by GitHub Pages at `https://portesLima.github.io`.
- `dashboard-financeiro.html` — an exact mirror of `index.html`, kept in sync on every change
  (`cp index.html dashboard-financeiro.html` before committing). Always update both together.
- `contexto-projeto-bolso-certo.md` — background notes from initial setup (Google Cloud project,
  OAuth client, GitHub Pages setup steps). Historical context, not authoritative for current
  app behavior — the code is the source of truth.

Two planning documents (published as claude.ai Artifacts, not in the repo) drive the current
direction:
- **"Bolso Certo — Redesign"** — the UX redesign brief the 9-item round implemented against.
- **"Bolso Certo — Assinatura"** — the monetization plan (15-day trial, R$ 20/mo, Mercado
  Pago recommended, minimal Supabase backend, LGPD, phased roadmap). Fase 1 (trial + block,
  no gateway) is done; Fase 2 (backend + gateway) and Fase 3 (Play Store via TWA) are open.
Ask the user for the URLs if a future session needs them.

## Commands

There is no build or lint tooling — this is intentional (see Architecture). Workflow:

```bash
# Syntax-check the inline <script> block after editing (Node has no HTML parser,
# so extract the script content first). On this machine /tmp resolves oddly under
# Git Bash — write to a local scratch file instead:
node -e "
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
fs.writeFileSync('scratch_s.js', matches[0][1]);
"
node --check scratch_s.js && rm scratch_s.js

# Keep the mirror file in sync before every commit:
cp index.html dashboard-financeiro.html

# Publish: commit + push to main — GitHub Pages redeploys automatically (~1-2 min)
git add dashboard-financeiro.html index.html sw.js
git commit -m "..."
git push origin main
```

Repo root: `index.html` (app), `dashboard-financeiro.html` (mirror), `sw.js` (service worker —
a única exceção ao arquivo único; ver "PWA / Service worker"), `.nojekyll`, `CLAUDE.md`,
`contexto-projeto-bolso-certo.md`.

### Test suite (headless browser)

**⚠ A suíte original (~770 checks / 22 scripts, descrita abaixo) foi PERDIDA.** Ficava no
scratchpad temporário das sessões, nunca foi versionada, e a pasta foi limpa (confirmado em
28/10/2026: scratchpads vazios, sem rastro no git nem nos logs de sessão). A descrição abaixo é
**histórica** — serve de especificação do que cada teste cobria, não de scripts que existam.

**`tests/` é o local oficial** (versionado). Rodar (1ª vez: `cd tests && npm install`): `node tests/run-all.js` (ou um script só:
`node tests/test-xxx.js`). Usa `playwright-core` (`tests/package.json`; `lib.js` ainda cai para `C:/tmp/pw-check5` se não instalado) + canal
`msedge`; `tests/lib.js` tem `abrir()` (relógio fixo opcional via `page.clock`, fuso
`America/Sao_Paulo`, captura erros de console/página em `page.__erros`), `ok()`, `res()`. Hoje:
- `test-hoje-local` (4) — `hojeISO()` local às 23:30 BRT, virada de mês no dia 30
- `test-avisos-vencimento` (52) — `contasParaAvisar`, banner, dispensar, Ver, funil de estado, modal,
  notificações
- `test-regressao-minima` (31) — consumidores de `hojeISO` às 23:30, ida-e-volta de estado com blob
  novo/antigo, 4 abas sem erro de console (vazio e com dados), marcar pago/desfazer vs. banner,
  erro no banner não derruba `render()`
- `test-importacao` (166) — **reconstrução (Bloco 1)**: `parseOFX` (SGML/XML, NAME·MEMO, limite de 80 chars,
  DTPOSTED com fuso, FITID ausente, blocos inválidos), `parseValorBR`, `parseCSVBolsoCerto`, `conciliarImportacao`
  (FITID, ±1 dia, valor/tipo/conta, `descSimilar` a 60%, duplicata no arquivo), fluxo `iniciarImportacao`
  (OFX/CSV/windows-1252, erros), `confirmarImportacao` (campos, toast, `desfazer`, substituir, mês de destino),
  reimportação, trial bloqueado, ida-e-volta `exportarCSV` → `parseCSVBolsoCerto`. Check de comportamento
  atual que parece bug leva o prefixo `[BUG-CONHECIDO]` (nenhum hoje: o `TRNAMT` do OFX ganhou parser próprio, `parseTrnAmt`).
- `test-trial` (113) — **reconstrução (Bloco 2)**: primeira abertura (`trial_iniciado` 1x), fronteiras D+0/1/9/10/14/15/16/400
  (D+15 ainda é trial; D+16 bloqueia), virada à meia-noite local, `body.readonly` (o que bloqueia: `adicionar`,
  registro rápido, categorias, importar; o que continua: abas, filtros, CSV, 3 PDFs, ajuda, backup pelo modal),
  `?readonly=1`, "Assinar" provisório, telemetria 1x (`trial_expirado` com `bc_tel_expirado2`, `assinar_clicado`
  com `via`), relógio para trás, `assinatura` ausente/corrompida, merge no sync. PostHog é um stub em memória
  (`window.posthog` com `__SV`), nada vai à rede. Prefixos: `[BUG-CONHECIDO]` (parece errado hoje) e
  `[PROVISORIO-FASE2]` (vale só sem backend/cobrança — vai falhar de propósito quando a Fase 2 entrar).
- `test-categorias` (228) — **reconstrução (Bloco 3)**: `normalizarCategoriasUsuario`; adicionar (vazio, espaços, 30/31,
  duplicata em outra caixa, reservadas, cores da paleta); renomear (vínculos em lançamentos, orçamento e contas fixas,
  restaurar, colisões); excluir (sem uso, com uso + destino, destino padrão, cadeia, renomeada, `Outros`); nomes hostis
  (HTML/aspas/emoji/barra) em ~10 telas; limites de orçamento (0, vazio, alto, vírgula/ponto, `Infinity`); "Orçamento em
  risco" e alertas em 79/80/100/101 %; persistência (recarregar, `montarEstado`, `aplicarDadosImportados`, backup por arquivo,
  blob antigo). 14 `[BUG-CONHECIDO]` (escape de HTML em 6 telas, `palpitarCategoria` × renome, 80 % em ponto flutuante…).
- `test-saldos` (110) — **reconstrução (Bloco 4)**: `efeitoNoSaldo`, `saldoAtualConta`/`saldoContaEm` (saldo inicial negativo e com
  data futura, transferências nas duas pontas, pendente/vencido/futuro fora), faixa "Você tem hoje" e card "Fim do mês" contra
  um cenário com as contas à mão, ponto flutuante (0,1+0,2), ciclo de fatura (fechamento/vencimento, dia do fechamento,
  dez→jan, fev/bissexto), card de faturas e parcelas × fatura. Usa `emulateMedia({reducedMotion:'reduce'})` para o texto dos
  KPIs não passar pelo tween. 9 `[BUG-CONHECIDO]`.
- `test-pdf` (93) — **reconstrução (Bloco 4)**: `exportarCSV` (BOM, `;`, aspas, quebra de linha, acentos, status efetivo, BRL
  cru, ida e volta) e os 3 PDFs (`exportarPDF`/`Anual`/`IR`) com o jsPDF real e o construtor espiado (texto desenhado por
  `doc.text`, páginas, tamanho; `save()` interceptado): totais e contagem de linhas batem com a tela, mês/ano vazio, 70
  linhas em várias páginas, texto hostil. 6 `[BUG-CONHECIDO]`.
- `test-estado` (236) — **reconstrução (Bloco 5)**: guard das chaves de armazenamento (toda `STORAGE_*` está no funil ou é
  local de propósito: `pin`, `onboardingVisto`, `cambioCache`; chaves `bc_*` diretas: `bc_aviso_venc_dispensado`,
  `bc_tel_expirado2`) e dos 13 campos de `montarEstado()`; cada campo por `aplicarDadosImportados` → storage → recarregar →
  backup → 2º aparelho limpo; funções `salvar*` na chave certa; `importarBackupJSON` com entrada cancelada/inválida/vazia/
  antiga/com chaves extras/tipos errados/muito grande; desfazer de 1 nível (extrato, parcelada, backup); sync com o Drive
  simulado em memória (`context.route` em `googleapis.com`: last-write-wins, 2 aparelhos, erros 401/500/vazio/corrompido);
  PIN (ativar, inválidos, errado, trocar, fora do backup/Drive); `?readonly=1` (sem escrita, sem telemetria). Depois da
  leva 1 (G, H, G2) e o P3 da leva 2 restam 2 `[BUG-CONHECIDO]` aqui (conflito entre 2 aparelhos e PIN "Esqueci o PIN").
- `test-responsivo` (291) — **reconstrução (Bloco 6)**: sem rolagem horizontal em 360/390/768/1280 × tema claro/escuro × vazio/cheio
  (com as 3 barras do topo) × abas (+ Análise) e nos 11 modais (guard: a tabela de modais cobre todo `.modal-bg`); barra inferior
  e FAB medidos por `elementFromPoint`/`visualViewport`/`offsetTop` (não por `getBoundingClientRect().bottom`), com a altura do
  viewport variando (barra de endereço do iOS); tabela→cartões; reflow a 640×400 e 320 px; `prefers-reduced-motion`. 16
  checks `[BUG-CONHECIDO]`. Auxiliares em `tests/a11y-helpers.js` (contraste WCAG, alvos, nomes acessíveis, overflow).
- `test-a11y` (116) — **reconstrução (Bloco 6)**: `lang`, landmarks, títulos, contraste de texto por cálculo WCAG sobre as cores
  computadas (2 temas × 390/1280 × 5 telas + 11 modais + tela inicial/PIN + placeholders + borda dos campos), foco visível pelo
  Tab, alcance por teclado, Esc/foco/trap/`role=dialog` nos modais, foco de volta ao gatilho, botões e campos sem nome, `svg`/
  `canvas`/`img`, alvos de toque ≥ 44 px. 21 checks `[BUG-CONHECIDO]`. Nota: o app foca o 1º campo do registro rápido (`#rapValor`) e do assistente
  (`#onbContaNome`) **50 ms depois** de abrir (`setTimeout`); o teste espera o foco por condição (`waitForFunction`, limite 400 ms) — medir no instante 0
  era uma corrida intermitente. Os outros 10 modais não movem o foco.
- `test-escape` (40) — **leva 2 · P4**: texto do usuário (descrição, etiqueta, conta, categoria, meta, cartão, cor) nunca vira HTML.
  (1) **Guarda de código-fonte:** um scanner de template literals (multilinha e aninhados) lê o `index.html` e exige `escHtml(...)` em
  todo `${...}` com nome de usuário dentro de HTML/toast, em `<option>${c}</option>` de contas e em `onclick="...'${...}'..."`. Exceções
  declaradas **pela expressão**, cada uma com o motivo (hoje 2: `t.fixo?…` e `corCategoria(…)`). (2) **Dinâmico:** payloads `<img onerror>`,
  `"><b id=…>`, `<script>`, aspas e barra invertida em todas as abas, Dicas, selects, modais, toasts, "Orçamento em risco" (toque), janela do
  comprovante e cor importada; nada injetado, `window.__x` indefinido, sem `ERR_FILE_NOT_FOUND`. Regra para código novo: **qualquer texto do
  usuário em template de HTML passa por `escHtml`; para handler inline use `data-*` + `this.dataset.x`, nunca o texto entre aspas no `onclick`;
  cor só `#hex` (`corHexValida`)**.
- `test-nomes` (9) — **Leva 3 · K**: guarda de código-fonte de nomes acessíveis (botões, campos, svg), `<main>`/`<header>` e `role="alert"`; sem navegador.
- `test-ids` (13) — **Leva 3 · M**: `uid()` monotônico com colisão forçada (relógio e `Math.random` fixos) em extrato, parcelas, transferências, duplicar, contas fixas e metas.

### Checks `[BUG-CONHECIDO]` convertidos em checks do comportamento correto (nome antigo → nome novo)

Regra da leva 1: nenhum `[BUG-CONHECIDO]` é apagado; vira um check do comportamento correto (a tag sai). Os nomes ganharam
texto novo (mais descritivo). Lista para auditoria — arquivo `tests/test-estado.js` salvo indicação:

**Pacote G (Drive)**
- `[BUG-CONHECIDO] mesmo com o PATCH devolvendo 500 o botão mostra "Sincronizado com Drive"…` → `PATCH com 500: o botão mostra "🔴 Não sincronizou" (nunca "Sincronizado")`
- `[BUG-CONHECIDO] erro 500 ao LER o arquivo do Drive num aparelho novo: …sobe o estado vazio…` → `leitura 500: o Drive NÃO recebe nenhuma escrita (sem PATCH, sem arquivo novo, conteúdo intacto)` (+ locais preservados, faixa, trava de escrita)
- `[BUG-CONHECIDO] resposta 200 com corpo VAZIO … também faz o aparelho novo sobrescrever o Drive…` → `leitura 200 com corpo vazio: o Drive NÃO recebe nenhuma escrita (…)`
- `[BUG-CONHECIDO] erro 500 ao LISTAR os arquivos: …CRIA outro "bolsodados"…` → `erro 500 ao LISTAR: NÃO cria outro "bolso-certo-dados.json"` (+ `listagem 500: …`)
- (sem tag, comportamento mudou) `arquivo do Drive corrompido: o local é mantido e sobe para o Drive (reparando o arquivo)` → `arquivo do Drive corrompido (JSON inválido): o Drive NÃO recebe nenhuma escrita (…)` + `corrompido: o arquivo do Drive continua como estava`

**Leva 2 · P3 (link só de leitura)** — `tests/test-estado.js`
- `[BUG-CONHECIDO] abrir o link só de leitura num aparelho SEM dados inicia o teste de 15 dias (grava bc_assinatura)…` → `abrir o link só de leitura num aparelho SEM dados NÃO grava nada: não inicia o teste de 15 dias (antes gravava bc_assinatura)` (+ `… sem trialInicio, sem faixa de contagem regressiva`)
- `[BUG-CONHECIDO] com o Drive SEM arquivo, o link só de leitura CRIA o arquivo e sobe o estado local…` → `com o Drive SEM arquivo, o link só de leitura NÃO cria o arquivo nem sobe o estado local (zero escritas no Drive)`
- (novos) PostHog nem é inicializado em modo leitura (e é, 1 vez, fora dele); o assistente de primeiros passos não aparece; o que vem do Drive fica só na memória (storage intacto, sem `bc_drive_usa`/`bc_drive_pendente`); Drive com `{}` não é inicializado; `adicionar()` pelo console muda a memória mas **nada persiste**.

**Leva 2 · P2 (backup visível com o trial vencido)** — `tests/test-trial.js`
- `[BUG-CONHECIDO] com o trial vencido e o modal dispensado, NENHUM botão de backup fica visível…` → `com o trial vencido e o modal dispensado, o menu ⚙️ mostra "Baixar backup (.json)" (um único botão de exportar)` + `o item de exportar backup NÃO tem .editable-only` + `clicar gera o arquivo (versao 1, com os lançamentos), fecha o menu e funciona com o app bloqueado`
- (novos) `IMPORTAR segue escondido` (painel de backup, campo de arquivo e botões que o abrem) e o painel de comprovantes também. A função `importarBackupJSON` continua SEM guard próprio (caracterização, decisão de não criar guards de lógica enquanto o trial for burlável por DevTools).

**Leva 2 · P1 (`parseOFX` / `TRNAMT`)** — `tests/test-importacao.js`
- `[BUG-CONHECIDO] OFX com TRNAMT "-12.500" importa como -12500 (esperado -12.5)` → `OFX com TRNAMT "-12.500" importa como -12,5 (parser próprio do TRNAMT: só ponto = decimal)`
- `[BUG-CONHECIDO] parseValorBR("-12.500") = -12500 (ponto+3 dígitos lido como milhar…)` → **mesmo comportamento, agora sem tag**: `parseValorBR("-12.500") = -12500 — INTENCIONAL na digitação` (o `parseValorBR` não muda; "12.500" digitado é doze mil e quinhentos). Idem `parseValorBR("0.500") = 500`. Não eram bug do `parseValorBR`: o bug era o OFX usá-lo.
- (novos) 18 valores válidos e 9 inválidos de `TRNAMT` (`1.234,56`, `1,234.56`, `-1234,56`, `0.5`, `.5`, `R$ 12,50`, `1.2.3`, `12abc`, `1e5`…); um `TRNAMT` inválido derruba só a própria transação. Nota: hoje `12abc` e `1.2.3` eram ACEITOS pelo `parseFloat` (12 e 123); agora são rejeitados.
- **P1b (commit à parte):** `parseOFX` e `parseCSVBolsoCerto` contam o que descartaram por data/valor inválido (`ignoradas`, só presente quando > 0), `importacaoPendente.ignoradas` o guarda e a pré-visualização avisa "N lançamento(s) do arquivo foi/foram ignorado(s) (data ou valor inválido)" (também quando o arquivo só tem lançamentos inválidos: "nenhum lançamento válido neste arquivo", em vez de parecer extrato vazio). Antes o descarte era silencioso. Sem `[BUG-CONHECIDO]` correspondente (comportamento novo).

**Leva 2 · P4 (escape de HTML)** — `tests/test-categorias.js`, `tests/test-pdf.js`, `tests/test-escape.js` (novo)
- `[BUG-CONHECIDO] <superfície>: o nome da categoria entra SEM escapar e vira HTML (N <img> injetado); esperado: escHtml` (×6: tabela, lista de Orçamento, "Orçamento em risco", contas fixas, alertas, Dicas) → `<superfície>: o nome da categoria aparece como texto (escapado), nenhum <img> injetado`
- `[BUG-CONHECIDO] a cor de uma categoria importada (backup/Drive) entra no atributo style sem validação…` → `a cor de uma categoria importada (backup/Drive) só vale se for #hex: a cor com aspas é descartada e não injeta atributo (onmouseover)`
- `[BUG-CONHECIDO] "Orçamento em risco" → toque na linha com aspas duplas / barra invertida no nome NÃO filtra pela categoria (onclick inline quebra)` (×2) → `"Orçamento em risco" → toque na linha com aspas duplas / barra invertida no nome leva ao filtro certo` (o apóstrofo já funcionava e segue)
- `[BUG-CONHECIDO] consequência observável dos payloads: <img src=x> tenta carregar "x" e o toque no risco com aspas dá SyntaxError na página` → `consequência observável dos payloads: nenhuma imagem "x" é buscada e nenhum SyntaxError na página`
- (`test-pdf`) `[BUG-CONHECIDO] a DESCRIÇÃO do lançamento também entra sem escapar na tabela de Lançamentos…` → `a DESCRIÇÃO do lançamento é escapada na tabela de Lançamentos: nenhum <img> injetado`; `… e o navegador tenta carregar "x" (erro de recurso esperado)` → `… e o navegador não tenta carregar "x" (nenhum erro de recurso)`
- (`test-a11y`, efeito colateral) `[BUG-CONHECIDO] a janela do comprovante (verAnexo) escreve a <img> SEM alt…` → `a janela do comprovante (verAnexo) escreve a <img> com alt="Comprovante: …" (escapado)`
- (novos) `test-escape`: guarda do código-fonte + dinâmico (acima). **Correção:** `escHtml` em ~45 pontos (5 toasts, 4 `<option>` de contas, `renderListaContas` reescrita com `data-conta` no lugar do nome em `onclick/id`, "Orçamento em risco" com `data-cat`, alertas, Dicas, tabela, orçamento, metas, fixas, saldos por conta, comprovante com `alt`/`<title>` escapados, botão excluir categoria com `data-chave`); `corHexValida` em `corCategoria`, `normalizarCategoriasUsuario` e `renderListaCategorias`.

**Leva 2 · P5 (centavos e consistência)** — `tests/test-saldos.js`, `test-categorias.js`, `test-pdf.js`
- Helper único `cent(x)` (`Math.round(x*100)`), usado **só** nestes pontos de decisão: `saldo` e `saldoAnt` do `render()` ("Sobrou"), `livre` do "Fim do mês", alerta/risco/barra de orçamento (**estourou**: `cent(gasto) >= cent(limite)`; **80 %**: `cent(gasto)*5 >= cent(limite)*4`, sem multiplicar por 0,8) e a frase/herói do PDF mensal. Não espalhar pelo resto do app.
- `[BUG-CONHECIDO] 0,30 − (0,10 + 0,20) = −5,5e-17 é mostrado como "-R$ 0,00"…` → `0,30 − (0,10 + 0,20) fecha ao centavo: "R$ 0,00" (antes: "-R$ 0,00" por resíduo de −5,5e-17)`
- `[BUG-CONHECIDO] saldo 0,30 e contas a pagar 0,10 + 0,20 … aparece como "faltam R$ 0,00" no vermelho…` → `saldo 0,30 e contas a pagar 0,10 + 0,20 (sobra exatamente R$ 0,00): "você fica com R$ 0,00" (antes: "faltam R$ 0,00" no vermelho)`
- `[BUG-CONHECIDO] 10 × R$ 0,10 contra limite de R$ 1,00 mostra "100%" mas NÃO "estourou"…` → `10 × R$ 0,10 contra limite de R$ 1,00 (soma 0,9999999999999999): mostra "estourou" (antes: "100%" sem estourar)`
- `[BUG-CONHECIDO] gasto 2,40 de limite 3,00 (exatamente 80%) NÃO entra em risco…` → `gasto 2,40 de limite 3,00 (exatamente 80%) ENTRA em risco (antes: 3 × 0,8 = 2,4000000000000004 deixava de fora)`
- (`test-pdf`) `[BUG-CONHECIDO] 0,30 de receita − (0,10 + 0,20) de gasto: o PDF diz "- R$ 0,00" e "você gastou R$ 0,00 a mais do que ganhou"…` → `… o PDF diz "R$ 0,00" no positivo (antes: "- R$ 0,00" e "você gastou R$ 0,00 a mais do que ganhou")`
- `[BUG-CONHECIDO] limite Infinity/1e400 é gravado como null (JSON) e se perde ao recarregar…` → `limite "Infinity" é REJEITADO na digitação: o orçamento não muda (antes era gravado como null e se perdia)` (+ `"1e400"` idem; o check `"Infinity" é aceito como limite` foi removido: era a caracterização do bug). `setOrcamento` rejeita ±Infinity com toast "Valor do limite inválido."
- `[BUG-CONHECIDO] renomear para o nome reservado "Receita" é ACEITO…` → `renomear para o nome reservado "Receita" é BLOQUEADO (mesma regra do adicionar; antes era aceito)` (+ `"transferência"` em outra caixa)
- `[BUG-CONHECIDO] renomear aceita nome de 80 caracteres…` → `renomear com nome de 80 caracteres é BLOQUEADO (limite de 30, igual ao adicionar; antes era aceito)` (+ exatamente 30 é aceito)
- `[BUG-CONHECIDO] orçamento com valor 0 não conta como uso… chave órfã { Lazer: 0 }` → `orçamento com valor 0 = "sem limite": a categoria some SEM painel e a chave { Lazer: 0 } é limpa do orçamento` (0 segue **não** contando como uso; excluir a categoria apaga a chave)
- `[BUG-CONHECIDO] a opção transitória "Fantasma (fora da lista)" continua no select depois de cancelar a edição…` → `a opção transitória "Fantasma (fora da lista)" some do select ao cancelar a edição` (`data-transitoria`, removida em `cancelarEdicao`)
- Fora do P5 (não refeito): persistência do tema (já no pacote H).

**Leva 2 · P6 (exportação CSV e PDF)** — `tests/test-pdf.js`
- **CSV:** `csvTexto()` (antes de `exportarCSV`) nos campos de **texto** (descrição, categoria, conta, etiqueta): quebra de linha vira espaço e, se começa com `=`, `+`, `-` ou `@`, ganha um `'` na frente. O campo **Valor** não passa por aí (o sinal de "-12,50" é legítimo). `parseCSVBolsoCerto` tira o `'` da descrição **só** quando ele protege `= + - @` (um `'x` comum fica como está).
- **PDF:** `pdfTruncar` e o chip de categoria normalizam quebra de linha/espaços repetidos em 1 espaço. `exportarPDF` (mensal) **respeita o filtro de conta do topo** (mês e "mês anterior"); `pdfCabecalho(doc, titulo, ref, escopo)` escreve o escopo ao lado do título em chamada de texto à parte ("· Conta: Itaú" / "· Todas as contas"; o título continua exatamente "Relatório mensal"). Anual e IR ignoram o filtro e dizem "· Todas as contas".
- `[BUG-CONHECIDO] descrições que começam com = + - @ são exportadas SEM neutralização…` → `descrições que começam com = + - @ saem com apóstrofo na frente (…; antes: sem neutralização)` (+ novos: categoria/conta/etiqueta idem e o valor numérico intacto; `'normal` fica como está)
- `[BUG-CONHECIDO] ida e volta pelo parseCSVBolsoCerto PERDE o lançamento cuja descrição tem quebra de linha…` → `ida e volta pelo parseCSVBolsoCerto traz os 3 lançamentos (a descrição com quebra de linha agora volta com espaço; antes SUMIA em silêncio)` (+ novo: ida e volta de `=1+1`, `-abc`, `'x`)
- (sem tag, texto mudou) `descrição com ";", aspas e quebra de linha sai íntegra…` → `… e a quebra de linha vira espaço (antes: ficava dentro das aspas)`; `aspas duplicadas ("") e a quebra de linha ficam DENTRO das aspas` → `aspas duplicadas ("") ficam DENTRO das aspas e o texto não tem mais quebra de linha`
- `[BUG-CONHECIDO] o PDF mensal IGNORA o filtro de conta do topo…` → `o PDF mensal RESPEITA o filtro de conta do topo: Entrou R$ 0 / Saiu 1.354,50, igual à tela (antes: 3.500 / 1.754,50 de todas as contas)` (+ novos: cabeçalho "Conta: Itaú"; anual e IR "Todas as contas" mesmo com filtro; sem filtro o mensal soma tudo e diz "Todas as contas")
- `[BUG-CONHECIDO] descrição com quebra de linha vai crua para doc.text…` → `descrição com quebra de linha vira UMA linha de texto (espaço no lugar da quebra; antes ia crua para doc.text e invadia a linha seguinte)`


**Pacote E ("Fim do mês" e "dura até")** — `tests/test-saldos.js`
- `[BUG-CONHECIDO] o "ritmo atual" soma o aluguel PENDENTE de 28/09 como se já tivesse sido gasto…` → `com saldo inicial: o aluguel PENDENTE de 28/09 não entra no ritmo (100 pagos em 10 dias = 10/dia) → "ok"` (+ `novo usuário com aluguel pendente de 900 no dia 28: … R$ 20/dia → "ok"`)
- `[BUG-CONHECIDO] sem saldo inicial, a receita PENDENTE de 500 é contada duas vezes…` → `sem saldo inicial (…): "Resultado do mês até agora" = 800 … e "Fim do mês" = 1.300 (a receita pendente de 500 conta UMA vez)` (×4 formas de "sem": sem entrada, valor texto, valor null, só data)
- `[BUG-CONHECIDO] e a faixa "Resultado do mês até agora" já mostra 1.300 contando a receita de 500 que AINDA NÃO entrou…` → coberto pelo mesmo check (faixa = 800)
- (novos) COM saldo inicial 0 com/sem data, 100, 100 com data futura; filtro de conta; recém-chegado com receita pendente + conta a pagar (1.200); receita pendente já vencida; pago com data futura fora do ritmo. Os valores de referência 3.329,20 / 2.329,20 / 110,91 NÃO mudaram.

**Pacote D (`addMeses`)** — `tests/test-saldos.js`
- `[BUG-CONHECIDO] addMeses("2026-01-31", 1) = 03/03 (o JS estoura fevereiro); esperado 28/02 — uma compra parcelada no dia 31 pula uma fatura inteira` → `addMeses("2026-01-31", 1) = 28/02 (limita ao último dia do mês de destino…)`
- `[BUG-CONHECIDO] addMeses("2026-08-31", 1) = 01/10 (setembro só tem 30 dias); esperado 30/09` → `addMeses("2026-08-31", 1) = 30/09 (…)`
- `[BUG-CONHECIDO] addMeses("2026-01-30", 1) = 02/03; esperado 28/02` → `addMeses("2026-01-30", 1) = 28/02 (antes: 02/03)`
- `[BUG-CONHECIDO] mesmo em ano bissexto: 31/01/2028 + 1 mês = 02/03; esperado 29/02` → `mesmo em ano bissexto: 31/01/2028 + 1 mês = 29/02 (antes: 02/03)`
- (novos) 588 combinações contra um oráculo independente (anos 2026/27/28/2100/2000 × todos os meses × dias 29/30/31 × +0/+1/+2/+12), virada de ano, mês negativo, 12 parcelas do dia 31 partindo da data original, formulário real (3x de 31/01; 5x de 30/12) e conta fixa no dia 05.

**Pacote A2 (categoria "" legada, só exibição)** — `tests/test-categorias.js`
- `[BUG-CONHECIDO] resíduo (não migrado de propósito): lançamento antigo com categoria "" aparece com chip vazio na tabela e com NOME VAZIO em "Para onde foi o dinheiro" e na lista de orçamento` → `tabela: o lançamento com categoria "" mostra o chip "Outros"` + `"Para onde foi o dinheiro": o "" soma com o "Outros" real numa linha só (90 + 5 = 95)` + `lista de orçamento: "Outros" junta o "" com o real`
- `[BUG-CONHECIDO] resíduo: a dica sai quebrada — "Sua maior categoria de gasto é , representando 90%…"` → `dica: "Sua maior categoria de gasto é Outros, representando 90% do total gasto no mês."`
- `[BUG-CONHECIDO] resíduo: editar() um lançamento com categoria "" abre o formulário com a 1ª categoria da lista ("Moradia")…` → `editar() num lançamento com categoria "" abre com "Outros" selecionado…`
- (novos) filtro "Outros" inclui o ""; "Orçamento em risco" e alerta contam o "" dentro de "Outros"; `contarUsoCategoria`; o dado gravado não é reescrito; em `test-pdf`: chip "Outros" no PDF mensal e soma única no anual e no IR; CSV exporta "Outros" para o "" (sem reescrever o dado).

**Pacote A (categoria do palpite)** — `tests/test-categorias.js`
- `[BUG-CONHECIDO] palpitarCategoria devolve o nome PADRÃO ("Alimentação") mesmo depois de renomeada para "Comida"/oculta…` → `palpitarCategoria passa pelo mapa de renomes: "IFOOD pedido" → "Comida"`
- `[BUG-CONHECIDO] registro rápido: o palpite aplica "Alimentação" (nome padrão) a um select que só tem "Comida" → o select fica SEM valor…` → `registro rápido: o palpite escolhe "Comida" no select (a categoria renomeada)`
- `[BUG-CONHECIDO] … e o gasto é salvo com categoria VAZIA ("")…` → `… e o gasto é salvo em "Comida" (nunca com categoria vazia)`
- (novos) palpite com categoria oculta/excluída → "Outros"; importação de extrato respeita o renome; formulário completo, registro rápido e conta que se repete com select vazio → "Outros"; 3 checks `[BUG-CONHECIDO]` de resíduo (dado antigo com `""`).

**Pacote H (backup)**
- `[BUG-CONHECIDO] o TEMA vindo de um backup/Drive é aplicado na tela mas NÃO é gravado em bc_tema…` → `o TEMA vindo de um backup/Drive é gravado em bc_tema (e não só aplicado na tela)`
- `[BUG-CONHECIDO] depois de recarregar o tema volta para "dark"…` → `depois de recarregar o tema do backup continua "light"`
- `[BUG-CONHECIDO] o arquivo de backup NÃO tem campo de versão do formato…` → `o arquivo de backup traz "versao": 1 (primeiro campo)`
- `[BUG-CONHECIDO] arquivo JSON válido que não é um backup (X) APAGA lançamentos, metas, fixas e orçamentos e ainda diz "sucesso"…` (×6: `{}`, `[]`, `{"foo":1}`, número, string, `true`) → `arquivo JSON válido que não é um backup (X): NADA muda, avisa "Esse arquivo não parece um backup do Bolso Certo" e não diz sucesso` (×7: entrou também o `null`, antes só "Não foi possível ler")
- `[BUG-CONHECIDO] backup antigo também ZERA as categorias do usuário e as preferências de avisos…` → `backup antigo PRESERVA as categorias do usuário e as preferências de avisos do aparelho…`
- `[BUG-CONHECIDO] backup com tipos errados ("transacoes": "abc") é aceito sem validação…` → `backup com tipos errados ("transacoes": "abc"): REJEITADO, nada muda e avisa` (e o sem-tag `… e o render() quebra com esse estado` → `… e o app continua renderizando com os tipos corretos`)
- `[BUG-CONHECIDO] backup maior que a cota do localStorage … a gravação FALHA em silêncio…` → `backup maior que a cota do localStorage: a memória é REVERTIDA ao que estava (2 lançamentos) e o storage fica como estava` (+ aviso "Não coube…" e chaves pequenas desfeitas)
- `[BUG-CONHECIDO] importar backup NÃO zera o snapshot do desfazer anterior…` → `importar backup ZERA o snapshot do desfazer anterior (o "Desfazer" perde a validade)`
- `[BUG-CONHECIDO] clicar no "Desfazer" do lançamento anterior DEPOIS de importar o backup troca os dados importados pelos antigos…` → `clicar no "Desfazer" do lançamento anterior DEPOIS de importar o backup NÃO troca os dados importados pelos antigos`
- Efeito em outros scripts (sem tag; o comportamento "campo ausente zera" mudou de propósito): `test-avisos-vencimento` `blob antigo -> 3 true` → `blob antigo (sem o campo) -> MANTÉM as preferências locais`; `test-regressao-minima` `blob antigo (sem o campo): 3 true` / `…persistido no storage` → `…MANTÉM as preferências locais` / `…o storage continua com a preferência local`; `test-categorias` `blob antigo … → shape vazio`, `… volta às 12 padrão`, `blob {} → defaults`, `…com lixo → defaults` → mantêm o local / `{}` não muda nada / lixo é REJEITADO; `test-trial` `remoto com assinatura não-objeto é ignorada` → o blob inteiro é REJEITADO (`backup-invalido`).

**Leva 3 · I (layout do celular)** — `tests/test-responsivo.js` (227 → 291 checks; 320 px entrou em `VPS`), `tests/test-a11y.js`
- `<nav id=navPrincipal>` sem o `style="margin-bottom:18px"` (a margem de 18 px do desktop foi para a regra base `.tabs`). Variáveis do bloco ≤1023: `--bar-h:62px`, `--safe-b:env(safe-area-inset-bottom,0px)`, `--fab-d:56px`; barra com `height:calc(var(--bar-h) + var(--safe-b))`; FAB `bottom: bar + 16px`; toast `bottom: bar + 16px + FAB + 12px`; `.wrap` `padding-bottom: bar + 16 + FAB + 16`. O `<meta viewport>` **não** tem `viewport-fit=cover` (não alterado: `env()` vale 0 hoje; decisão pendente do dono).
- `NN px: [BUG-CONHECIDO] a barra de abas FLUTUA 18px acima da borda da tela…` (×4: 360/390/768, +320 novo) → `NN px: a barra de abas fica COLADA na borda da tela (hit-test na última linha de pixels acha a barra; folga 0; antes: flutuava 18px por causa do margin inline)`
- `NN px: [BUG-CONHECIDO] o FAB invade a barra de abas em 3px…` → `NN px: o FAB fica ≥ 4px ACIMA da barra de abas (folga Npx; antes: invadia 3px)`
- `viewport 390×ALT: [BUG-CONHECIDO] com a altura visível variando… a barra continua 18px acima do rodapé e o FAB a toca…` (×4) → `viewport 390×ALT: com a altura visível variando (barra de endereço do iOS), a barra continua colada ao rodapé e o FAB, ≥ 4px acima dela`
- `NN px · metas: [BUG-CONHECIDO] rolando até o fim, o FAB cobre o botão "Calcular" do simulador…` (×2) → `NN px · metas: rolando até o fim, o FAB não cobre nenhum botão/campo (antes: cobria o "Calcular" do simulador)` (o check "else" das outras abas foi absorvido por este, com o mesmo texto; novo: `o último controle … fica acima da barra` em geral/orçamento/metas × 360/390)
- `[BUG-CONHECIDO] o toast (com "Desfazer") se sobrepõe ao FAB na Visão Geral…` → `o toast (com "Desfazer") não se sobrepõe ao FAB nem à barra na Visão Geral …; antes: cobria o FAB` (o teste agora espera a transição do toast terminar antes de medir)
- `… · geral: [BUG-CONHECIDO] a Visão Geral ESTOURA a 320px (rolagem horizontal de Npx): as linhas .orc-val…` (×2) → `… · geral: a Visão Geral NÃO estoura mais a 320px e as 4 abas continuam visíveis (antes: rolagem horizontal por causa das linhas .orc-val)`. Causas corrigidas: `.orc-label`/`.orc-val` encolhem (`flex-shrink:1; min-width:0; overflow-wrap:anywhere`), `.cols`/`.cols2` ≤599 com `minmax(0,1fr)` e `canvas{max-width:100%}` (a Análise e, por tabela, os 11 modais estouravam a 320 px).
- (`test-a11y`) `[BUG-CONHECIDO] alvos de toque MENORES que 44×44 no celular (37 tipos)…` → `alvos de toque ≥ 44×44 no celular: nenhum tipo abaixo do mínimo (antes: N tipos abaixo)`. Regra só em ≤599: `min-height:44px` em `button`/`select`/`textarea`/`input` (exceto checkbox/radio), `min-width:44px` em `button`, `label.chk`, `span.small[role=button]`, `[role=tab]` e `.orc-row[role=button]` (não é só "padding invisível": campos de formulário ficam ~6 px mais altos no celular).
- Capturas de conferência: `tests/capturas/` (390 e 320 px × claro/escuro × Visão Geral/Metas, topo e fim) — **fora do git** (`.gitignore`).

**Leva 3 · M (ids únicos em lote)** — `tests/test-ids.js` (novo, 13 checks)
- **Bug:** `uid()` era `Date.now() + sorteio(0..999)` a **cada** chamada, e 3 lugares somavam `+i`/`+1` a ele — dois itens do MESMO lote (extrato, parcelas, transferência) podiam cair no mesmo id; editar/excluir um afetava o outro. Achado por uma falha intermitente de `test-importacao` ("ids únicos").
- **Correção:** `uid()` é **monotônico** na sessão (`_uidUltimo`: o maior entre o candidato e o último+1). Tipo e formato **iguais** (número inteiro, `Date.now()` + até ~1000): ids já gravados continuam válidos e **não são migrados**. Os 3 `uid()+n` viraram `uid()` (importação `id: uid() + i`, parcelas `uid()+i`, entrada da transferência `uid()+1`).
- **Todos os geradores de id** (grep `uid()`): transferência (`grupoTransferencia` + 2 pernas), compra parcelada (`grupoParcela` + N parcelas), lançamento simples, registro rápido, meta, aporte de meta (lançamento `metaId`), conta fixa, lançamento da conta fixa, duplicar, importação de extrato. Todos usam `uid()`; o guarda do teste falha se aparecer `uid() +` no código.
- **Teste:** relógio e `Math.random` congelados (colisão forçada: o `uid()` antigo devolvia o mesmo número 500×) e uma variante ADVERSARIAL (sorteio decrescente, que fazia `uid()+i` colidir em todos os itens). 500 ids distintos em `uid()`, no extrato (nos 2 cenários) e 528 em 11 compras de 48 parcelas; 100 transferências (200 pernas, 100 grupos), 100 duplicações, 100 contas fixas, 100 metas. Nenhum check antigo mudou de nome.
- **Duplicados já gravados:** não migrados, e o app **não tem nenhum caminho que os detecte** (nem aviso, nem validação no backup/Drive; `validarDadosBackup` não olha ids). Conferência manual no console: `new Set(transacoes.map(t=>t.id)).size === transacoes.length`. Fora de escopo: colisão ENTRE aparelhos (ids de sessões diferentes), que continua possível.

**Leva 3 · K (rótulos e semântica)** — `tests/test-a11y.js`, `tests/test-responsivo.js`, `tests/test-nomes.js` (novo, 9 checks)
- **Botões de ícone:** `aria-label` em × (6 modais, categorias, contas, contas fixas), ✓ ✎ ⧉ 📎 × da tabela, "+ add"/📈/✎/× das metas; nas linhas de lista o nome do item vai junto ("Marcar como pago: Aluguel"), sempre com `escHtml` (regra da Leva 2).
- **Campos:** `aria-label` em todos os `input`/`select` que só tinham placeholder ou nada (34 estáticos + limite de orçamento, categoria do extrato importado). Escolha: `aria-label` (não `<label>` + `sr-only`) — o visual não muda e não há classe nova; o rótulo visual onde existe (`<label>` envolvente, "Conta:") segue valendo.
- **Landmarks:** `<header class="top">` e `<main id="conteudoPrincipal">` (envolve as 4 seções; as faixas de aviso ficam fora). `.wrap`, ids e seletores dos testes não mudaram.
- **SVG** da marca (3): `aria-hidden="true" focusable="false"`. **Erros** `#categoriaErro` e `#pinErro`: `role="alert"`.
- **Movimento:** `@media (prefers-reduced-motion: reduce){ .sec-fade{ animation:none } }` (o `fadeIn` das seções rodava com a preferência ligada).
- **Guarda `test-nomes`** (sem navegador, ms): lê o corpo do `index.html` — marcação estática **e** templates, inclusive `${ cond ? `<button…>` : '' }` aninhados — e falha se surgir `<button>` só com símbolo/emoji sem `aria-label`, `input`/`select`/`textarea` sem `aria-label`/`<label for>`/`<label>` envolvente, ou `<svg>` sem `aria-hidden`/`role="img"`. Exceções (hoje 0) iriam em `EXCECOES`, cada uma com regex e motivo. Ignora comentários de linha e `<!-- -->`, **não** os de bloco (um `image/*` em atributo engolia 100 KB de código e escondia botões). Complementa o dinâmico do `test-a11y` (só vê o que está visível em cada tela).
- `[BUG-CONHECIDO] botões só com símbolo e SEM aria-label…` → `nenhum botão visível só com símbolo (✓ ✎ ⧉ × …) sem aria-label (antes: N ocorrências em vários tipos)`
- `[BUG-CONHECIDO] campos de formulário SEM rótulo associado…` → `todo campo de formulário visível tem rótulo associado (<label for>, <label> envolvente ou aria-label); o placeholder deixou de ser o único nome`
- `[BUG-CONHECIDO] os 3 <svg> (logo da marca) não são decorativos nem nomeados…` → `os 3 <svg> (logo da marca) são decorativos (aria-hidden="true"); antes: nenhum era`
- `[BUG-CONHECIDO] as mensagens de erro de formulário (#categoriaErro, #pinErro) NÃO são região viva…` → `as mensagens de erro de formulário (#categoriaErro, #pinErro) são região viva (role=alert)… (antes: não eram)`
- `[BUG-CONHECIDO] o app não tem landmark <main> nem <header>/banner…` → `o app tem 1 landmark <main> (as 4 seções) e 1 <header> (topo)… (antes: nenhum dos dois)`
- (`test-responsivo`) `[BUG-CONHECIDO] com prefers-reduced-motion: reduce o fade-in (fadeIn) das seções AINDA roda ao trocar de aba…` → `com prefers-reduced-motion: reduce o fade-in (fadeIn) das seções NÃO roda ao trocar de aba (antes: rodava…)`

**Leva 3 · J (modais e teclado)** — `tests/test-a11y.js` (108 → 116 checks)
- **Helpers (um par para todos os `.modal-bg`):** `dialogoAbriu(m)` / `dialogoFechou(m)`, disparados por um `MutationObserver` no `style` de cada modal (o mesmo princípio de `_sincronizarTravaScroll`: **nenhuma** das ~20 chamadas de abrir/fechar mudou). Abrir: guarda o gatilho (`document.activeElement`; senão o último botão tocado há < 1,5 s — Safari/iOS não foca `<button>` ao tocar; item do menu ⚙️ → `#btnConfig`) e leva o foco ao 1º controle visível (ou ao `.modal-box` com `tabindex=-1`). Fechar: devolve o foco ao gatilho se ainda visível (e não há outro diálogo por cima com o foco). `keydown` global: Tab/Shift+Tab presos no modal de cima; Esc chama a **mesma função do ×** via `MODAL_FECHAR_ESC` (ex.: `fecharModalRapido` continua onboarding-aware).
- **Semântica:** `role="dialog" aria-modal="true"` e `aria-labelledby` (título com `id`; nos que têm × dentro do `<h2>` o texto ganhou um `<span id>`) no `.modal-box`; o assistente de primeiros passos usa `aria-label="Primeiros passos"` (conteúdo dinâmico).
- **Esc NÃO fecha, de propósito (3 modais):** `modalDriveConflito` (decisão obrigatória), `modalTrialFim` (o "Continuar só consultando" dispara a telemetria `continuar_consultando_clicado`; fechar por Esc criaria um 2º caminho para o evento — mudar isso é decisão de produto) e `modalOnboarding` (tem "pular tudo"/"pular este passo"). Os 9 restantes fecham.
- **Abas:** `<nav aria-label="Seções do app">` continua landmark e agora **contém** `<div class="tabs" id="navPrincipal" role="tablist">` (o `id` e o CSS ficaram no `div`); botões `role="tab"` com `aria-selected` (no lugar do `aria-current`). Lançamentos/Dicas deixaram de ser `<div onclick>`: `<button role="tab">` num `role="tablist"`. Resumo/Análise já eram botões. Nos 3 grupos: **tabindex móvel** (só a aba ativa entra no Tab) e ←/→/Home/End movem **e ativam** a aba. `mudarAbaPrincipal`, `mudarAba` e `aplicarSubAbaGeral` mantêm `aria-selected`/`tabindex`.
- `[BUG-CONHECIDO] NENHUM dos 11 modais tem role="dialog" + aria-modal="true" + nome…` → `TODOS os N modais têm role="dialog" + aria-modal="true" + nome (aria-labelledby/aria-label); antes: nenhum tinha`
- `[BUG-CONHECIDO] a tecla Esc NÃO fecha nenhum dos 11 modais…` → `a tecla Esc fecha N-3 dos N modais; os 3 de decisão obrigatória (conflito do Drive, fim do teste, primeiros passos) continuam abertos de propósito (antes: Esc não fechava nenhum)`
- `[BUG-CONHECIDO] ao abrir N-2 dos N modais o foco NÃO vai para dentro dele…` → `ao abrir, o foco vai para DENTRO de todos os N modais (antes: N-2 deixavam o foco no botão que abriu)`
- `[BUG-CONHECIDO] o foco do Tab ESCAPA do modal…` → `o foco do Tab NÃO escapa de nenhum dos N modais (Tab/Shift+Tab circulam dentro; antes escapava em N)`
- `[BUG-CONHECIDO] ao fechar um modal o foco NÃO volta ao botão que o abriu em NENHUM dos 4 fluxos testados…` → `ao fechar um modal o foco VOLTA ao botão que o abriu nos 4 fluxos testados (…); antes: em nenhum`
- `<tela>: [BUG-CONHECIDO] as sub-abas "Lançamentos" e "Dicas" são <div onclick> sem role, sem tabindex e sem tecla…` → `<tela>: as sub-abas "Lançamentos" e "Dicas" são <button role="tab"> alcançáveis pelo teclado (antes: <div onclick> sem role, sem tabindex e sem tecla)`
- (novos, seção 4a) ArrowRight/ArrowLeft em Lançamentos/Dicas; ArrowRight/Home em Resumo/Análise; ArrowRight/End nas abas principais; tabindex móvel; o `<nav>` segue landmark e contém o tablist.

**Leva 3 · J, K e M publicados como `2026-10-29.27`:** J (modais acessíveis: role=dialog, foco preso e devolvido, Esc; abas como tablist com setas; **sem Esc** no conflito do Drive, no fim do teste e nos primeiros passos — decisão do dono), K (aria-label nos botões de ícone e campos, `<main>`/`<header>`, SVG decorativo, `role=alert`, movimento reduzido, guarda `test-nomes`) e M (`uid()` monotônico: ids únicos em extrato, parcelas e transferências). Restam 16 checks `[BUG-CONHECIDO]`: contraste (L, só proposta até aprovação) e trial/estado.

**Leva 3 · I publicado como `2026-10-29.26`:** barra inferior colada ao fundo, FAB/toast sem sobreposição, Visão Geral/Análise/modais sem rolagem horizontal a 320 px e alvos de toque ≥ 44 px no celular (detalhes e lista "nome antigo → nome novo" acima). Decisões do dono: `viewport-fit=cover` **não** entra e os campos de formulário ficam ~6 px mais altos no celular. Restam 28 checks `[BUG-CONHECIDO]` (a11y e trial/estado), a tratar em J, K e L.

**Resumo da leva 2 (publicada como `2026-10-29.25`):** P1 `parseTrnAmt` (OFX), P1b contagem de ignoradas na importação, P2 backup visível com o teste vencido, P3 link só de leitura sem gravar, P4 escape de HTML (`test-escape`), P5 centavos/consistência (`cent()`), P6 exportação (CSV sem fórmula, PDF mensal com filtro de conta). Suíte: 22 scripts (`run-all`) "tudo verde". **Checks `[BUG-CONHECIDO]` restantes: 44** (principalmente a11y e responsivo = Leva 3, mais trial e estado; os 2 de estado são conflito entre 2 aparelhos e "Esqueci o PIN").

A suíte original foi perdida; esta é a reconstrução (em blocos, por área de risco). Reconstruir os demais é opcional e deve ser feito a partir da lista histórica abaixo, **versionando
em `tests/` desde o início**.

*(Histórico)* There **was** a test suite — a set of standalone Playwright scripts kept in the session
scratchpad (not committed; they drive `index.html` over `file://`). They are the real
verification that a change works, and every change in the UX rounds was gated on them staying
green. As of the last round there are **~770 checks across 22 scripts** (`test-dobra` has
2–3 known fails when the system date's day-of-month < 5 — the early-month guard in
`renderDobraSaldo` suppresses the "apertado" branch and the "configure contas" sub-line;
`test-responsivo` has 1 known fail, "toast acima do FAB" on the max-density mobile case;
`test-fimdomes` can flake by 1 for a single run if executed across the local midnight
boundary — re-run settles it; all confirmed identical on clean `main`):

- `test-trial` — trial countdown, soft-block, `podeEditar()`, sub-modal state (Fase 1)
- `test-saldo-anterior` — the "Sobrou (com o mês anterior)" composition (3 lines + total) and
  the "ver como foi calculado" audit trail (entrou/saiu of the previous month, `verMesAnterior`)
- `test-toast` — confirmation toast + undo, `commitTransacoes()` funnel
- `test-sync-undo` — Drive debounce vs. undo timing (fast undo absorbed, slow undo converges)
- `test-dobra` — the "Você tem hoje" band + status phrase colour thresholds
- `test-fimdomes` — the "Fim do mês" headline (sobra/falta), collapsible detail
- `test-hierarquia` — Resumo/Análise sub-tabs, first-Análise chart sizing, nothing-lost checks
- `test-microinteracoes` — number tweens only fire on real value change; skeleton lifecycle
- `test-responsivo` — 3 breakpoints × tabs × themes, bottom bar, table→cards, max-density mobile
- `test-a11y` — every text token ≥ 4.5:1 on every surface (both themes), touch targets ≥ 44px
- `test-criterios-gerais` — "understand the balance without touching anything", "log a gasto in <5s"
- `test-pdf` — `exportarPDF`/`exportarPDFAnual` via construtor-spy: 1 pág / N págs / mês vazio /
  anual, marca + rodapé + "sobrou do mês anterior" presentes, arquivo leve
- `test-telemetria` — `rastrear()` via stub do PostHog: cada evento dispara no ponto certo e
  1x só quando deve, payload sem dado financeiro/pessoal, `?readonly=1` não rastreia, falha
  silenciosa sem PostHog
- `test-importar` — `parseOFX` (2 bancos: tags abertas/fechadas, ponto/vírgula, NAME/MEMO),
  `parseCSVBolsoCerto`, `conciliarImportacao` (FITID exato, aproximada ±1 dia, dedup no
  arquivo, não concilia entre contas), fluxo completo entra no funil, reimport não duplica,
  substituir, arquivo vazio/corrompido, guard de trial
- `test-sw` — sobe servidor `http://localhost` real: SW registra, precache do shell, offline
  serve o app, CDNs fora do cache, guard do `?v=`, faixa de atualização aparece e o clique em
  Atualizar troca o cache
- `test-copy-a11y` — "Livre para gastar" some do markup; campos de valor aceitam vírgula
  (`47,90`→`47.9`, `1.234,56`, `47.90` US) em todos os pontos; `type`/`inputmode` corretos;
  `editar()` abre pt-BR; 7 gráficos com `role="img"` + `aria-label` com números reais; Dicas em
  2 blocos; rótulos novos das telas secundárias; `recTipo`/`recDesc` não vazam
- `test-ir` — `exportarPDFIR`: `saldoContaEm` nos 3 casos (número / `undefined` sem saldo
  inicial / `null` conta ancorada depois da data); PDF com aviso legal, saldo por conta em
  31/12, gastos por categoria, entradas-que-podem-ser-rendimento; ano parcial; ano sem receita
- `test-onboarding` — wizard de 3 passos: 1ª abertura mostra passo 1; criar conta (vírgula
  aceita) → passo 2 abre o `#modalRapido`; lançar gasto OU fechar pelo × → passo 3 (sem estado
  preso); "Começar a usar" → `onboardingVisto` + aba Visão Geral; "pular este passo" / "pular
  tudo"; 2ª abertura não mostra nada
- `test-categorias` (37 checks) — Gerenciar categorias: adicionar aparece nos 5 selects +
  orçamento + tem cor da paleta; renomear padrão preserva vínculo em transações/orçamento/
  recorrentes e herda a cor; excluir com uso pede destino e reatribui; padrão sem uso oculta
  (constante intacta); `'Outros'` sem botão excluir; `editar()` de tx com categoria fora da
  lista não troca em silêncio; `montarEstado` inclui o campo; ida-volta por
  `aplicarDadosImportados` mantém `adicionadas`/`ocultas`; `normalizarCategoriasUsuario` tolera lixo
- `test-contas-visao` (44 checks) — "Ver todas as pendentes/pagas": ignora o filtro de mês,
  filtra por `statusEfetivo` em todo o histórico (pendente inclui vencido, transferência
  nunca); ordenação (pendente asc por vencimento, paga desc); corte de 12 meses + "ver N
  mais antiga(s)" (inclusive com lista vazia); tag "parada há N meses"; `visaoContas`
  sobrevive a `render()` E a `desfazer()` (não reseta pro mês); marcar como pago da lista →
  toast + Desfazer, item sai da lista mas a visão continua; filtro de conta respeitado;
  soft-block esconde o `✓` sem guard extra
- `test-proximo-pagamento` (26 checks) — a linha "Próximo pagamento" no card "Fim do mês":
  `proximoPagamento()` = próximo `gasto` pendente com `data >= hoje` (ignora vencido, receita,
  transferência); independente do mês selecionado; empate no dia = soma + "e mais N"; cor por
  proximidade (hoje/≤5 dias/neutro); marcar como pago → linha avança pro seguinte; some sem
  pendentes e fora do mês corrente; respeita filtro de conta; não cria transação
- `test-modal-contas` (61 checks) — os 2 defeitos de iPhone real: legenda visível
  ("Saldo inicial" / "Data do saldo") acima de cada campo em 4 viewports; input de data
  ≥16px e dentro do card; sem scroll-x com o modal aberto; nada vaza pela direita; `body`
  trava ao abrir e destrava + repõe a posição do scroll ao fechar; transição
  onboarding→`#modalRapido` mantém a trava sem flicker
- `test-responsivo` também recebeu 5 checks: o antigo "toast acima do FAB" na aba
  Lançamentos ficou obsoleto (o FAB some lá) — reescrito para afirmar que o FAB some e
  refazer a checagem toast-vs-FAB na Visão Geral, onde ele aparece
- `audit-visual.js` (não é da suíte — é o harness de auditoria visual, 406 combos
  tela × breakpoint × tema): `MEDIR()` tem uma checagem **#6** que simula a largura real
  de `<input type=date|file>` no iOS (o Chromium headless os renderiza bem menores) e
  flagra a linha que transbordaria; a defesa aceita é o input encolher (`max-width:100%`)
  OU a label quebrar em coluna

Harness notes: `playwright-core` (not full `playwright`) with the `msedge` channel works
headless. Load over `file://`, click `#btnEntrarApp`, then dispensar `#modalOnboarding` —
o novo wizard só aparece **depois** do `#btnEntrarApp` (disparado em `entrarNoApp()`), e o
1º `<button>` dele é "Adicionar e continuar" (exige nome). Dispensar via
`.onb-rodape [onclick*="concluirOnboarding"]` ("pular tudo"), ou pré-setar
`localStorage bc_onboardingVisto = 'true'` no `addInitScript`. `file://`
disables CORS features (Google sign-in, currency API) — those only work on the deployed
`https://` origin. Script-scoped `let`s are reachable from `page.evaluate()` as bare globals,
so `montarEstado()` / `aplicarDadosImportados()` / `render()` can be called directly. Values
that animate (`fmtValorAnimado`) need a ~300–600ms wait before reading `.textContent`, or read
`el.dataset.valor` (the target) — ou emule `reducedMotion:'reduce'` e releia o texto direto. **Não existe "quirk de 18px" do headless na barra inferior:** era o `margin-bottom:18px` inline do `<nav id="navPrincipal">`, corrigido na Leva 3 · I (a barra agora fica colada ao fundo; FAB, toast e o `padding-bottom` do `.wrap` derivam de `--bar-h`/`--safe-b`/`--fab-d`). See the browser-test-harness memory for a ready scaffold.

**Currently in flux:** the app is being tested in daily use, so more UX changes are expected.
Keep the antes/depois + "what doesn't change" + test-driven discipline that the UX rounds used.

## Architecture

**Single HTML file, single `<script>` block, no modules.** All state lives in top-level `let`
variables (`transacoes`, `orcamentos`, `contas`, `metas`, `recorrentes`, `contasDetalhes`,
`saldosIniciais`, `assinatura`, `moedaAtual`, etc.) mutated directly by event handlers, then
persisted and re-rendered — there is no framework, no virtual DOM, no reactivity system. Every
UI update goes through one function, `render()`, which recomputes everything (KPIs, charts,
tables, alerts) from the in-memory state and month/period filters currently selected in the
DOM. `render()` is large and populates elements by id — moving an element between containers
(even a hidden sub-tab) is safe as long as it stays in the DOM.

### Persistence: three layers, always in this order

1. **`window.storage`** (`getJSON`/`setJSON` helpers) — a key-value API provided by the
   Artifacts runtime. This is per-device/per-browser and the only storage that works offline.
   On GitHub Pages the runtime does **not** provide it, so a shim at the very top of the
   `<script>` falls back to `localStorage` (keys prefixed `bc_`) with the same
   `get(k)→{value}|null` / `set(k,v)` / `remove(k)` interface. Without the shim, `getJSON`/
   `setJSON` on the published site failed silently (empty `catch`) and nothing persisted
   per-device — only Drive saved. Don't call `fetch`/`localStorage` for app state directly;
   go through `getJSON`/`setJSON`.
2. **Google Drive** (`drive.file` OAuth scope) — a single JSON file (`bolso-certo-dados.json`)
   per user, holding the full app state (see `montarEstado()`). This is what makes data
   available across devices. Sync is one-way-at-a-time and debounced: any mutation calls
   `driveAgendarSync()`, which waits ~1.2s (`syncTimer`) then PATCHes the whole state via
   `driveSalvarAgora()`. There is no merge logic — the last write wins.

   **Regras de proteção (pacote G, leva 1):** `driveApi` lança erro tipado (`e.status`) em qualquer `!res.ok`. "Arquivo não
   existe" só vale para listagem OK e vazia; resposta de erro, corpo vazio ou JSON inválido = "não sei" → o app **não escreve
   nada** no Drive, segue com os dados locais e mostra a faixa `#barraDrive` ("🔴 Não consegui falar com o Drive — seus dados
   locais estão preservados" + **Tentar de novo**). **Trava de escrita:** `driveLeituraOk` (em memória) só vira `true` após uma
   leitura inicial bem-sucedida; sem ela `driveAgendarSync`/`driveSalvarAgora` não escrevem. PATCH com falha mostra
   "🔴 Não sincronizou" (nunca "Sincronizado" sem `res.ok`). Nova tentativa automática ao voltar ao primeiro plano
   (`visibilitychange`), no máx. 1 a cada 60 s (`performance.now`, porque `Date` é congelado nos testes). Nunca cria um 2º
   arquivo se a listagem falhou. Limitação mantida: ao recuperar a leitura, o Drive **substitui** o local (sem merge).

   **Alterações que não subiram (pacote G2, leva 1):** duas chaves `localStorage` **locais de propósito** (fora do funil, como
   `bc_aviso_venc_dispensado`): `bc_drive_usa` (gravada na 1ª leitura bem-sucedida: "este aparelho sincroniza com o Drive") e
   `bc_drive_pendente` (marca persistente de "há alterações deste aparelho que não chegaram ao Drive"). `driveAgendarSync()`
   grava a marca a cada mutação em aparelho que usa o Drive (com ou sem token); só um PATCH confirmado a limpa, e só se não há outro
   envio agendado (`syncTimer`). **Sem a marca, conectar continua last-write-wins silencioso.** Com a marca, ao reconectar com a
   leitura OK e o Drive com dados, `driveSincronizarInicial` **não substitui nem escreve nada** e abre `#modalDriveConflito`:
   "Manter os dados deste aparelho" (`driveConflitoManter`: libera a escrita e sobe o local) ou "Usar os dados do Drive"
   (`driveConflitoUsarDrive`: `salvarSnapshot()` antes, depois substitui; toast com **Desfazer** — o snapshot guarda só os
   lançamentos). Drive com `{}` + marca: sem pergunta, o local inicializa o arquivo. **Arquivo do Drive ilegível** (JSON inválido ou
   formato inesperado) **e aparelho com dados**: a faixa `#barraDrive` ganha "Substituir o Drive pelos dados deste aparelho"
   (`driveSubstituirPeloLocal`, com `confirm()` que avisa que o arquivo será SOBRESCRITO; nunca escreve sozinho). Erro 500 e corpo
   vazio **não** oferecem esse botão. Não resolve conflito entre dois aparelhos (sem merge — Fase 2).

   **Backup / importação (pacote H, leva 1):** `aplicarDadosImportados()` (usado pelo Drive **e** pelo backup por arquivo)
   chama `validarDadosBackup()` antes de tocar em qualquer coisa: precisa ser objeto; `transacoes` array (obrigatório só no
   backup por arquivo — o Drive aceita `{}` = arquivo novo); `orcamentos`/`contasDetalhes`/`saldosIniciais` objeto;
   `contas`/`metas`/`recorrentes` lista; `moeda` conhecida; `tema` dark|light; lançamento = objeto com `data` texto. Inválido →
   **nada muda** ("Esse arquivo não parece um backup do Bolso Certo"). **Campo ausente mantém o dado local; campo presente e
   vazio substitui** (`contas` vazio também mantém: sempre existe "Outros"). `setJSON` agora devolve `true/false` (o shim do
   localStorage devolve `false` na cota estourada): a importação grava tudo, e se algo falhar **desfaz as gravações já feitas e não
   mexe na memória** ("Não coube no armazenamento do aparelho. Nada foi alterado."). Importar zera `snapshotAnterior`
   (o "Desfazer" perde a validade). O arquivo exportado traz `versao: 1` (ausência = 1; versão maior é recusada pedindo
   para atualizar o app). O tema vindo do backup/Drive agora é gravado em `bc_tema`.

   **Link só de leitura — `?readonly=1` (P3, leva 2):** `modoLeitura()` é o ponto único. Nesse modo **nada é gravado**:
   `setJSON` devolve `true` sem gravar (o app trabalha só em memória; o que vem do Drive não persiste), o trial **não começa**
   (`carregarAssinatura` não grava `trialInicio`), o SDK do PostHog **nem é inicializado** (`posthog.init` no `<head>`), o assistente
   de primeiros passos não aparece, `driveAgendarSync`/`driveSalvarAgora` não escrevem, `driveMarcaSet`/`driveUsaSet` não gravam e
   `driveEncontrarOuCriarArquivo` **não cria** o arquivo (sem arquivo no Drive não há o que ler: status "ok", sem faixa vermelha). A leitura
   do Drive continua permitida. Exceção conhecida: dispensar o banner de vencimentos (✕) grava `bc_aviso_venc_dispensado` direto no
   \`localStorage\` (preferência de UI do aparelho).
3. **Manual JSON backup** (`exportarBackupJSON` / `importarBackupJSON`) — a full-state export/
   import users can trigger by hand.

**When adding a new piece of state**, wire it into all of: the top-level `let`, a `STORAGE_*`
key, the `getJSON` call in `carregar()`, `montarEstado()` (for Drive sync), and
`aplicarDadosImportados()` (the single funnel both `driveSincronizarInicial()` and
`importarBackupJSON()` go through — read + `setJSON` the field there). Missing one means the
field silently doesn't survive a sync or an import — this has been the source of most
cross-device bugs in this app. `assinatura` (the trial state) is the most recent field wired
this way; `saldosIniciais` before it (also persisted by `salvarContas()`).

**UI-only state that must survive `render()` but not persist** (e.g. `subAbaGeral`,
`detalheLivreAberto`) is a plain session `let` with an `aplicar…()` reapply function called
at the end of the relevant render path — deliberately *not* in the funnel above.

### Toast + undo funnel

Mutations to `transacoes` go through `commitTransacoes(msgToast, {comUndo, irParaMes})`:
`salvarSnapshot()` → `salvarTx()` → `popularSeletorMes()` → `render()` → `mostrarToast()`.
`salvarSnapshot()` is now taken on **adds too** (not just deletes), so the toast's "Desfazer"
covers logging and deleting. Deleting a *simple* transaction skips the old `confirm()` — the
6s toast is the undo. Installments and transfers keep their modal/confirm (blind undo on
multi-item is risky) and get a toast without "Desfazer". Two quick actions in a row: the
second toast replaces the first (first undo is lost) — intentional, like Gmail. The old
`#btnDesfazer` header button is gone; `desfazer()` and `snapshotAnterior` remain, called by
the toast.

**`marcarComoPago(id)`** (the row `✓` button, and the "ver todas as pendentes" list) now goes
through this funnel too — `salvarSnapshot()` + `commitTransacoes(msg, {comUndo:true})` — so a
single mark-as-paid gets the toast + Desfazer, same as logging/deleting. This is not a
technical necessity to update the month selector (`commitTransacoes` *and* `desfazer` already
call `popularSeletorMes()`); it's the deliberate consistency choice. The **batch**
`marcarSelecionadosComoPago()` keeps its `confirm()` + a plain `salvarTx()`/`render()` with no
undo — blind undo on N items is the same risk as installments/transfers.

### Importação de extrato (OFX / CSV)

Botão "📄 Importar extrato (OFX/CSV)" **por conta** dentro do modal `#modalContas`
(`renderListaContas`) — a conta entra pré-selecionada. Lançamentos importados são transações
**normais**: `iniciarImportacao()` → `#modalImportar` de pré-visualização →
`confirmarImportacao()` → `salvarSnapshot()` + `transacoes.unshift(...)` +
`commitTransacoes()`. **Não** passa por `aplicarDadosImportados()` (essa substitui o estado
inteiro). Novo campo por-transação `t.fitid` (id único do banco, do `<FITID>` do OFX) +
`t.importadoEm` — viajam no sync de graça porque `montarEstado` serializa `transacoes`
inteiro; nada a fazer no funil de estado.

- **`parseOFX(texto)`** → `{transacoes:[{data,desc,valor,fitid}], erro?}`. Sem biblioteca, sem
  `DOMParser` (OFX 1.x SGML não fecha tags). Fatia em `<STMTTRN>`, para cada bloco no próximo
  `<STMTTRN>` / `</STMTTRN>` / `</BANKTRANLIST>`. `ofxCampo()` lê campo tolerante a tag aberta
  (`/<TAG>\s*([^<\r\n]+)/`). `DTPOSTED` → pega `YYYYMMDD` (ignora hora/TZ). `TRNAMT` via
  `parseTrnAmt` (parser próprio — **não** `parseValorBR`: no OFX o ponto é decimal, `-12.500` = −12,5; só ponto/só vírgula = decimal,
  com os dois o último separador é o decimal, o mesmo separador repetido ou lixo → transação rejeitada). Descrição: `NAME` ou `MEMO`. Encoding: se `arquivo.text()` gerou
  `�`, retenta com `TextDecoder('windows-1252')`. Erro só se não há `<STMTTRN>` **e** não há
  `<OFX>`; `<OFX>` sem transação → `{transacoes:[]}` (fluxo trata "vazio" à parte).
- **`parseCSVBolsoCerto(texto)`** — só o formato que `exportarCSV` gera
  (`Data;Tipo;Descrição;…`, `;`, aspas `""`, BOM opcional). `Tipo` dá o sinal.
- **`conciliarImportacao(novas, conta)`** → `[{nova, status:'exata'|'suspeita'|'nova', existente?}]`,
  comparando **só contra transações da mesma conta**: (1) `fitid` igual → `exata` (filtrada,
  nem aparece); (2) data ±1 dia (`diasEntre`) + valor + tipo + `descSimilar()` (normaliza sem
  acento/pontuação, testa inclusão ou ≥60% de tokens em comum) → `suspeita` com o lançamento
  existente ao lado; (3) senão `nova`. Também dedup **dentro do próprio arquivo**.
- **`#modalImportar`**: lista rolável; `nova` vem marcada, `suspeita` vem **desmarcada** em
  âmbar com [manter os dois]/[ignorar novo]/[substituir]. Select de categoria por item
  (pré-preenchido por `palpitarCategoria`; travado em "Receita" para receitas). Descrições
  vêm de arquivo → renderizadas com `escHtml()`. Estado `importacaoPendente` (session `let`,
  não persiste). `podeEditar()` barra em trial bloqueado. Evento telemetria
  `extrato_importado` (`via: 'ofx'|'csv'`). Testado em `test-importar` (38 checks).

CSV de banco arbitrário (colunas variando, mapeador de colunas) fica para entrega futura.

### Auth: token renewal without a backend

Google Identity Services (`google.accounts.oauth2.initTokenClient`) issues short-lived
(~1h) access tokens with no refresh token in this client-only flow. `renovarTokenSilenciosamente()`
requests a new token with `prompt: ''` (no popup) whenever a 401 is hit or a session opens; a
50-minute proactive timer (`agendarRenovacaoToken`) does the same before expiry. Any new
authenticated Drive call should go through `driveApi()`, which already handles the 401 →
silent-renew → retry-once path — don't call `fetch` against the Drive API directly.

### Subscription / trial (Fase 1 — no gateway yet)

New state `assinatura` (`{status, trialInicio, assinouEm}`), wired through the full funnel
(top-level `let`, `STORAGE_ASSINATURA`, `carregarAssinatura()` in `carregar()`, `montarEstado`,
`aplicarDadosImportados`). 15-day free trial from first ever open; after that the app enters a
**soft block**: `body.readonly` (reuses the pre-existing read-only mode + `.editable-only`
class), the FAB and every write form hidden, an amber warning bar, and a "seu teste terminou"
modal. Read/filter/export/Drive-sync all keep working. `avaliarAssinatura()` computes the
effective status on boot; `podeEditar()` guards the three write entry points (`adicionar`,
`abrirModalRapido`, `salvarRapido`). `aplicarDadosImportados` merges the **oldest** `trialInicio`
between local and incoming — syncing across devices must not restart or extend the trial.

This is deliberately a logic-only phase to validate whether people hit the wall and want to
pay, before building a backend. **No gateway, no real charge** — the "Assinar" button just
unblocks (`assinarProvisorio`). The billing plan (Mercado Pago recommended, backend on
Supabase, LGPD, roadmap) is in the "Bolso Certo — Assinatura" artifact. Known limitation,
accepted for now: trial state lives only in `localStorage`/Drive — a determined user can
bypass it via DevTools. That closes only with the Fase 2 backend.

### Telemetria (PostHog)

Coleta **só contagem de eventos anônimos e agregados** para decidir a Fase 2 — nunca
lançamentos, valores, descrições, categorias, nome ou e-mail. Snippet oficial do PostHog no
`<head>` (projeto **US Cloud**, `api_host: https://us.i.posthog.com` — o snippet deriva a URL
de assets do `api_host`) com config mínima: `autocapture:false`, `capture_pageview:false`,
`disable_session_recording:true`, `advanced_disable_decide:true`, `property_denylist` de
URL/referrer. `BC_PH_KEY` guarda a *Project API Key* pública (`phc_…`). O guard
`BC_PH_KEY.indexOf('phc_COLE') !== 0` só pula o `posthog.init` se a key ainda for o placeholder
`phc_COLE_…` — com a key real, a telemetria está ativa.

**Chave corrigida na `.22`** (um `J` tinha sido transcrito como `3`: `phc_DjJk…`, não `phc_Dj3k…`): o PostHog descartou todos os eventos desde setembro; **a coleta real começa em 29/10/2026**. Flag renomeado de `bc_tel_expirado` para `bc_tel_expirado2` na `.22` para reenviar `trial_expirado` de aparelhos que perderam o evento pela chave errada; a data desses eventos é a da reabertura, não a do bloqueio real. Testado em `test-telemetria-expirado` (5 checks).

**Testes nunca enviam ao PostHog real** (`route` em `tests/lib.js`): `abrir()` chama `bloquearPosthog(ctx)`, que responde localmente (200 vazio) a qualquer `*posthog.com*` — nada sai pra rede. Os 2 testes de telemetria usam `interceptarPosthog(ctx, onPost)`: deixam passar só o GET do SDK (`us-assets…/static/array.js`) e respondem o POST `/e/` com `route.fulfill` 200, entregando o corpo ao teste. Sem isso, cada `run-all` poluía o projeto de produção com `sessao_iniciada`/`trial_iniciado`/`trial_expirado` de navegadores de teste. Auditoria opcional: `BC_PH_AUDIT=<arquivo> node tests/run-all.js` grava `BLOQ`/`FULFILL`/`PASS` por requisição (esperado: 0 `PASS` em `us.i.posthog.com`). Um `abort` não serve: gera `ERR_FAILED` no console e quebra os checks de "sem erro de console". A chave esperada fica como constante em `tests/test-telemetria-chave.js`, que falha se `BC_PH_KEY` divergir dela e confere o token do POST real para `us.i.posthog.com/e/`.

**`rastrear(evento, props)`** ([index.html](index.html), junto de `hojeISO()`) é o ponto
ÚNICO. Contrato: falha em silêncio (sem PostHog / não inicializado / ad-blocker → nada, sem
throw, sem log); **não dispara** com `?readonly=1` na URL; `props` só aceita as chaves de
`RASTREAR_PROPS_OK` (`['dias_de_trial','via']`) e só primitivos. O `distinct_id` (UUID
aleatório no `localStorage`, gerado pelo próprio SDK) é o único identificador — não é dado
pessoal; habilita a métrica de retenção.

Eventos e onde disparam: `sessao_iniciada` (fim de `carregar()`), `trial_iniciado`
(`carregarAssinatura()`, no `if` que grava `trialInicio` pela 1ª vez), `trial_expirado`
(`rastrearTrialExpiradoUmaVez()` em `avaliarAssinatura()` quando bloqueia — flag
`localStorage` `bc_tel_expirado2`, **fora** do funil de sync, 1x por aparelho),
`assinar_clicado` (`assinarProvisorio()`), `continuar_consultando_clicado`
(`continuarSoConsultando()`), `lancamento_criado` (`adicionar()` não-edição, transferência, e
`salvarRapido()` — só o fato, com `via`), `extrato_importado` (`confirmarImportacao()`,
`via: 'ofx'|'csv'`).

Linha de privacidade adicionada ao `#modalOnboarding` e ao `#modalPlanos`. **Não existe
documento formal de política de privacidade** — pendência registrada. Painel: posthog.com →
Funnels (`trial_iniciado` → `trial_expirado` → `assinar_clicado`) e Retention
(`sessao_iniciada`). Testado em `test-telemetria` (21 checks, PostHog stub sobre `file://`,
`?v=1` na URL evita o `location.replace` de cache-busting que senão zera o stub).

### Nome do card "Fim do mês"

Um conceito só. Nome de referência (código, comentários, docs, label estático `#livreTitulo`):
**"Fim do mês"**. Os ids internos são legado (`livreCard`, `livreTitulo`, `livreValor`,
`renderLivreParaGastar`) — não renomeados pra evitar churn, mas **nunca** "Livre para gastar"
como texto visível. No mês corrente `renderLivreParaGastar()` sobrescreve o label com a frase
dinâmica ("Depois de pagar as contas de {mês}, você fica com"); fora do mês corrente o card
some e o label volta pra "Fim do mês".

### Aba Dicas — 2 blocos

`renderDicas()` marca cada dica com `origem: 'voce'` (tirada dos dados do usuário — contas a
vencer, categoria acima da média, meta apertada, maior gasto do mês) ou `'geral'` (boa prática
fixa — 50/30/20, automatize a poupança, revise assinaturas, e os nudges de "defina
orçamento/crie meta" quando não há nenhum). Render em dois grupos: `<h3>Para você agora</h3>`
com as `voce` no estilo `.alert` (ou uma linha calma se não houver nenhuma), depois
`<h3 class="dicas-gerais-titulo">Boas práticas</h3>` com as `geral` em `.dica-geral` (fonte
menor, marcador `·`, sem ícone de alerta).

### Visão Geral: Resumo / Análise sub-tabs

`#secGeral` has two sub-tabs (`mudarSubAbaGeral('resumo'|'analise')`, `subAbaGeral` is a
session `let` — always resets to `'resumo'` on boot; every viewer opens wanting the summary
first). Same pattern as the Lançamentos/Dicas sub-tabs; the bottom bar stays at 4 tabs.

- **Resumo** (`#geralResumo`) — the "am I OK?" layer: the "Você tem hoje" band
  (`renderDobraSaldo`), the "Fim do mês" headline (`renderLivreParaGastar`), "Este mês"
  (Entrou/Saiu/Sobrou — fuses the old Receitas/Gastos/Saldo KPIs; taxa de poupança is now a
  sentence in the card footer, not its own KPI), alerts, "Orçamento em risco"
  (`renderOrcamentoRisco` — only categories ≥ 80% of limit, tap → Lançamentos filtered),
  "Para onde foi o dinheiro" (`renderParaOnde` — the category donut + top-3 slices as text),
  "Saldo por conta", "Orçamento total", "Maiores gastos".
- **Análise** (`#geralAnalise`) — investigation, one tap deeper: "Projeção de saldo" (moved
  here from Lançamentos > Dicas), "Últimos 6 meses", "Evolução do saldo", "Contas fixas vs.
  gastos do dia a dia", "Comparação anual" + a plain daily-average "Ritmo de gastos" line.

**"Este mês" — saldo transportado do mês anterior (`render()`, bloco `#cardEsteMes`):** quando
o mês **imediatamente anterior** fechou com resultado ≠ 0 (`saldoAnt = receitaAnt − gastoAnt`,
inclui pendentes, respeita o filtro de conta), esse valor é *transportado* para o mês atual: o
número grande de "Sobrou" vira `saldoAnt + saldo` e o rótulo vira "Sobrou (com o mês anterior)".
Abaixo, `#saldoAcumLinhas` mostra 3 linhas (Resultado do mês / Sobrou-ou-Faltou de {mês ant.}
"— entrou aqui" / Total), e `#saldoAuditoria` (toggle `toggleAuditSaldo`, `let auditSaldoAberto`
efêmero que sobrevive a `render()` como `detalheLivreAberto`) é a **trilha de auditoria**:
Entrou − Saiu = Resultado do mês anterior, com link `verMesAnterior(chave)` que troca `#mesSel`
e re-renderiza. **É só uma linha calculada — nenhuma transação é criada**, sem risco de dupla
contagem no estado. Escopo deliberadamente estreito: o transportado vive **só neste card** —
`renderDobraSaldo` ("Você tem hoje"), `renderLivreParaGastar` ("Fim do mês"), `renderAlertas`,
`renderDicas`, taxa de poupança e `renderProjecaoSaldo` continuam medindo **apenas o mês**.
Não acumula cadeia (só o mês anterior, não desde `HISTORICO_INICIO`).

**Chart.js measures a 0-size canvas inside `display:none`.** The Análise charts
(`chartMes`, `chartSaldo`, `chartFixoVar`, `chartProjecao`) are only built when
`subAbaGeral === 'analise'` — `render()` skips them otherwise, and `mudarSubAbaGeral('analise')`
does `render()` + `requestAnimationFrame(() => chart.resize())` to cover the first activation
of a session (canvas never had a real size). `renderProjecaoSaldo()` still runs its
text/data path always (`renderDicas` needs the return value) but guards only the chart build.

**Removed from Visão Geral this round** (documented, not lost): the standalone "Ritmo de
gastos" card — "seu saldo aguenta N dias" is now the `renderDobraSaldo` status phrase, in
plainer words; the raw daily average survives in the Análise tab. The 3 trend charts moved
from the fold to the Análise tab.

### Header + bottom bar (responsive)

Breakpoints: base ≤ 599 (mobile), 600–1023 (tablet), 1024+ (desktop). `.wrap` max-width 1120.
- **Desktop:** header shows Drive · Contas · Backup · theme · ⚙️; tabs are a normal row.
- **≤ 1023:** header keeps only logo + month + ⚙️ (Drive/Contas/Backup/theme move into the
  ⚙️ menu, `.so-mobile` / `.so-desktop` classes); the 4 main tabs become a **fixed bottom
  bar** (`.tabs#navPrincipal`, `<button>`s with icon + label, ≥ 52px); `.wrap` gets
  `padding-bottom`; the FAB and toast sit above it. The account filter lives on its own line
  (`.linha-filtro-conta`, "Conta: [select]") at all sizes.
- **≤ 599:** the Lançamentos table renders as cards (CSS grid on `<tr>`, `data-label` on
  `<td>`, no JS change); the "Este mês" 3-up grid becomes a 1-column list.

### Accessibility (WCAG-ish, this round)

Every text token is ≥ 4.5:1 on card, card2 and bg in **both** themes — the light theme
values were re-tuned (`--muted` `#5e646f`, `--amber` `#8a5808`, `--green` `#0b7a50`, `--red`
`#c52520`, `--blue` `#1a60bd`, `--purple` `#6b4fc4`); dark already passed. `getThemeColors()`
tick colour tracks `--muted`. Touch targets: `.iconbtn` ≥ 28px desktop / 44px in the mobile
list; clickable `<span>`s got `role="button"` + `tabindex="0"` + a global Enter/Space handler;
focus-visible outlines on tabs, sub-tabs, icon buttons, links.

**Gráficos (`<canvas>`) — `role="img"` + `aria-label`:** leitor de tela não enxerga canvas,
então cada `render*Chart` chama `descreverGrafico(canvasEl, texto)` ao fim, montando um resumo
textual com os números reais (top categorias + %, entrou/saiu por mês, saldo de/até, etc.).
Cobre os 7 gráficos (`chartCat`, `chartFixoVar`, `chartMes`, `chartSaldo`, `chartProjecao`,
`chartSimulador`, `chartEvolucaoMeta`). Estados vazios já têm `.empty-chart` (texto) como
alternativa.

**Campos de valor aceitam vírgula:** os inputs de dinheiro (`#valor`, `#rapValor`, `#metaValor`,
`#recValor`, `#simValorMensal`, o de limite em `orcEdit`) são `type="text" inputmode="decimal"`
e lidos por **`parseValorBR()`** (não `parseFloat`, que para no primeiro `,`). `parseValorBR`
cobre `"47,90"`, `"1.234,56"`, `"47.90"` (US) e `"1500"`. Inputs de **contagem** (`#parcelas`,
`#simMeses`, dias de cartão) seguem `type="number"`. `editar()`/`editarMeta()` abrem o campo já
formatado pt-BR (`toLocaleString('pt-BR')`).

### Microinteractions

`fmtValorAnimado(el, novoValor)` tweens a currency element ~260ms from its `dataset.valor` to
the new value; used by the "Você tem hoje" band, the "Fim do mês" headline, and the 3 "Este
mês" numbers. It has an internal guard: **only animates when the value actually changed**
(`|old − new| ≥ 0.01`) — a re-render with the same value (e.g. Resumo↔Análise toggle) writes
directly, no tween. Respects `prefers-reduced-motion` (writes final value immediately). The
opening screen (`#telaInicial`) shows a shimmer skeleton (`.skel`) while `carregar()` runs;
`#btnEntrarApp` is `visibility:hidden` until `atualizarResumoTelaInicial()` reveals it.

### Month/period filtering split

The **Visão Geral** tab (KPIs, all charts, alerts, budget-vs-actual) is always scoped to
`mesAtual`, the single month selected in the top dropdown — this is intentional and several
calculations (month-over-month delta, same-month-last-year, daily burn rate) only make sense
for exactly one month. The **Lançamentos** table is the one place that can show a wider slice:
when a date-range filter, the search box, **or `visaoContas`** has a value, the table switches
to querying all of `transacoes` instead of just `mesAtual` (see the `visaoContas` /
`periodoAtivo` / `buscaAtiva` branch in `render()` — `visaoContas` wins over the others).
Don't extend the wider-range behavior to the KPI cards — that would break the month-relative
math.

**"Ver todas as pendentes / pagas"** (2 buttons at the top of `#viewLista`,
`alternarVisaoContas('pendente'|'pago')`): `visaoContas` + `visaoContasTudo` are session
`let`s (not persisted), and — like `subAbaGeral` — survive `render()` and `desfazer()`
untouched; `render()` re-applies the button/chip state via `aplicarEstadoVisaoContas()` at the
end of the table block. When active, `baseTabela` is all of `transacoes` filtered by
`statusEfetivo` (`'pendente'` view includes `'vencido'`; transfers always excluded), honouring
the account filter. Default cut: last 12 months (`visaoContasCorte()`); `visaoContasAntigas`
counts what's beyond it and a "ver N mais antiga(s)" row (`verVisaoContasAntigas()` →
`visaoContasTudo = true`) expands it — that row must render even when `listaTabela` is empty
but old items exist. Sort: `'pendente'` view is **ascending by date** (overdue first = most
urgent); `'pago'` and normal mode are descending. Pendentes older than ~3 months get an amber
"parada há N meses" tag. Tested in `test-contas-visao` (44 checks).

### Installments vs. recurring items — different data shapes

- **Installments** (`parcelas > 1` on the transaction form): pushes N separate transactions
  upfront, sharing a `grupoParcela` id, each dated one month apart (`addMeses`, called as `addMeses(dataOriginal, i)` —
  never chained). **`addMeses` limita o dia ao último dia do mês de destino** (pacote D, leva 1: 31/01 → 28/02 → 31/03 → 30/04;
  antes `new Date(y, m, 31)` estourava para 03/03 e a parcela pulava uma fatura inteira). É o único chamador; a conta fixa
  (`lancarRecorrente`) usa sempre o dia 05 e `calcularCicloFatura` tem ajuste próprio de fim de mês. Parcelas JÁ gravadas com data
  errada **não são reescritas** — só as novas saem certas. The amount
  entered is the *per-installment* amount, not divided further. Deleting one asks whether to
  delete just that transaction or every transaction sharing `grupoParcela` (see
  `modalExcluirParcela`).
- **Recurring items** (`recorrentes` array): templates, not transactions. `lancarRecorrente()`
  creates one new transaction from a template on demand (one click per month) — nothing is
  auto-generated on a schedule.
- **Goal contributions** (`addValorMeta`): also synthesize a real transaction (`tipo:'gasto'`,
  `metaId` set) so the amount actually affects the month's balance/KPIs — a goal's `valorAtual`
  by itself does not.
- **Transfers** (`tipo: 'transferencia'`): two linked transactions sharing a
  `grupoTransferencia` id — one `subtipo:'saida'` on the source account, one
  `subtipo:'entrada'` on the destination, same date, always `status:'pago'`, `categoria:
  'Transferência'`. The distinct `tipo` is deliberate: every existing `t.tipo==='receita'` /
  `'gasto'` check ignores transfers automatically, so they stay out of all income/expense KPIs
  with no per-site filtering. Places that iterate *all* transactions and sign by
  `receita?+:−` (the "saldo acumulado" chart) must still exclude `tipo==='transferencia'`
  explicitly — grep for `!== 'transferencia'`. Deleting either leg removes both.

### The fold: "Você tem hoje" band + "Fim do mês" headline

Two adjacent elements at the top of Resumo, both current-month-only (hidden otherwise):

- **`renderDobraSaldo()`** — the "Você tem hoje" band: real account balance (sum of
  `saldoAtualConta()` for accounts with a `saldosIniciais` entry; else the month result, and
  `partidaReal` is false + a nudge to configure accounts) as one big blue number, plus a
  **status phrase** answering "will it last?": green (lasts past month-end), amber (lasts but
  tight, ≤ 5 days slack), red (runs out before month-end). **Early-month guard:** with < 5
  days elapsed the daily burn rate is noise (one big purchase → "R$ X/day" → "runs out day 2"),
  so alarmist branches are suppressed in favour of a calm "ainda é cedo para ter certeza".

- **`renderLivreParaGastar()`** — the "Fim do mês" headline, written as a sentence: "Depois de
  pagar as contas de {mês}, você fica com **R$ X**" (green) or "Para cobrir as contas de {mês},
  faltam **R$ X**" (red). Same anchor as the band, minus this month's still-open commitments
  (pending/overdue bills, open installments, not-yet-launched recurring), plus pending income.
  The breakdown (você tem hoje / − ainda falta pagar / = sobra|falta, with sub-lines) is
  collapsible on mobile (`detalheLivreAberto`, session `let`, "ver detalhe"), always expanded
  on desktop.

- **"Próximo pagamento"** — a full-width line at the bottom of the same card (`#livreProximo`,
  own top border, *not* inside the collapsible breakdown so it stays visible on mobile).
  `proximoPagamento()` (near `renderLivreParaGastar`) returns the next pending **`gasto`**
  (`status === 'pendente'`, `data >= hoje`) across all of `transacoes` — **independent of the
  selected month** (viewing August still shows a September due date), honouring the account
  filter; transfers/receitas never count; an already-overdue bill (`data < hoje`) is excluded
  (it's in the alerts, not "próximo a vencer"). Ties on the nearest day are summed ("Aluguel e
  mais 2 · R$ X"). Colour by proximity: red = today, amber ≤ 5 days, neutral beyond. It's
  read-only math on status/date — creates nothing, no double-counting. `renderProximoPagamento()`
  is called from `renderLivreParaGastar()`, so marking the next bill paid (Item A's toast flow)
  re-renders and the line advances to the following one. Hidden with the whole card when
  `mesAtual !== chaveCorrente`. Tested in `test-proximo-pagamento` (26 checks).

**"Sem saldo inicial" (pacote E, leva 1) — a condição exata no código:** `temSaldoInicial(nome)` = `saldosIniciais[nome]` existe **e**
`typeof valor === 'number'`. Logo: conta sem entrada → "sem"; entrada com valor texto/`null`/ausente (ex.: só a data) → "sem"; **valor 0 → COM** saldo
inicial (`partidaReal`); valor sem data `em` → COM (conta todo o histórico); `em` futura → COM (o saldo é só o `valor`, nada anterior conta).
"Sem saldo inicial" = NENHUMA conta atende isso. Nesse caso a faixa vira "Resultado do mês até agora" e o "Fim do mês" parte do mesmo número.
**Esse número é só o que JÁ entrou/foi pago** (receita `pago` − gasto `pago` do mês; respeita o filtro de conta na faixa, o "Fim do mês" ignora o
filtro). A receita pendente entra UMA vez, em "+ Ainda vai receber". Antes a receita pendente estava nos dois lugares (1.800 em vez de 1.300) — o
erro afetava justamente quem ainda não configurou saldo (quem está nos 15 dias de teste); com saldo inicial já estava certo. O **ritmo** da frase
"dura até" (`gastoMesAteAgora`) é só o gasto **pago com data ≤ hoje** ÷ dia do mês: gasto pendente (a vencer ou vencido) e pago com data futura
não entram (já estão descontados no "Fim do mês"). A faixa respeita o filtro de conta; com o filtro numa conta SEM saldo enquanto outra tem, a faixa
cai em "Resultado do mês até agora" daquela conta e o "Fim do mês" segue usando as contas com saldo (inconsistência conhecida, sem tag).

The band and headline answer different questions on purpose (how much I *have* / how much *is
left after paying what's due*) — kept visually distinct: band is blue, headline is green/red.
`renderProjecaoSaldo()` uses the same two-step anchor.

### Per-account balances

`saldosIniciais` (`{nomeConta: {valor, em}}`) is per-account starting balance — set in the
Contas modal, one value+date row per account (`editarSaldoInicialConta`). `saldoAtualConta(nome)`
= that value + Σ of **effectivated** movements on the account since `em` (`efeitoNoSaldo()`:
receita +, gasto −, transfer signed by `subtipo`) — **only** `status:'pago'` items and
transfers count, so pending bills don't reduce the shown balance (they surface as commitments
in the Livre card instead). `renderSaldosContas()` shows the "Saldo por conta" card (in Resumo), hidden
unless at least one account has a starting balance. **This card is deliberately kept** even
though the band shows a total — the sum hides the per-account picture (e.g. Nubank +5.000 and
a credit-card account at −1.200 net to +3.800, but you need to see the card is negative).

`saldoContas` (old single global-balance field) is **legacy**: the UI is gone; `carregar()`
migrates any stored value into `saldosIniciais[contas[0]]` on first load and nulls it. It's
still in `montarEstado()`/storage only so old backups/Drive files don't error — no new code
reads it.

### Top-bar ⚙️ menu

On desktop the header keeps Google Drive, Contas, Backup, theme, and ⚙️ visible; ⚙️
(`#menuConfig`, `toggleMenuConfig`) holds "Minha assinatura", **"Baixar backup (.json)"** (`#btnBackupMenu`, sem `.editable-only`: exportar
funciona com o teste vencido; importar continua escondido), PIN, currency, notifications,
read-only link — plus, on mobile only (`.so-mobile`), the Drive/Contas/Backup/theme entries
that leave the header. A document-level click handler closes it on outside click. `#btnTema`
and `#btnGoogle` have menu twins (`#btnTemaMenu`, `#btnGoogleMenu`) kept in sync by
`aplicarTema()` / `atualizarStatusGoogle()`.

### Registro rápido (FAB)

The floating `+` button (`#fab`) opens `#modalRapido` — a 2-field capture (valor + descrição)
plus account/category selects and a Gasto/Receita toggle. `palpitarCategoria()` guesses the
category from keywords in the description (`PALPITE_CATEGORIA` regex list). Entries are always
`status:'pago'`, dated today. `salvarRapido()` is a thin path that does **not** go through
`adicionar()` — no installments, no attachment, no fixo flag — but it does go through
`commitTransacoes()` (toast + undo) and is guarded by `podeEditar()`. Measured: `+` tap to
confirmation toast is ~1.2s.

**Categoria do palpite (pacote A, leva 1):** `palpitarCategoria()` devolve SEMPRE uma categoria que existe na lista: passa por
`nomeCategoriaPadrao()` (renome Alimentação→Comida → "Comida") e, se a padrão foi ocultada/excluída, cai em `'Outros'` (sem palavra-chave
casada continua `null`). Antes devolvia o nome padrão cru; o `<select>` não tinha essa opção, ficava vazio e o gasto era salvo com
`categoria: ""`. Além disso `adicionar()`, `salvarRapido()`, `criarRecorrente()` e `confirmarImportacao()` aplicam `|| 'Outros'`: **nunca
se grava categoria vazia**. Lançamentos antigos JÁ gravados com `""` **não são reescritos** (nada no storage muda), mas **na exibição aparecem como "Outros"** (pacote A2):
helper único `categoriaExibida(t)` (`""` → `Outros`; receita vazia → `Receita`; transferência vazia → `Transferência`), usado na tabela
(chip + cor), no filtro de categoria, em `porCat` (soma que alimenta "Para onde foi o dinheiro", Orçamento, risco, alertas, dicas e o
gráfico — o `""` **soma com o `Outros` real**), na média por categoria, em `contarUsoCategoria`, no `editar()` (abre com `Outros`, não com a
1ª da lista) e nos 3 PDFs. O **CSV exporta `""` como `Outros`** (o dado gravado não muda). Testado em `test-categorias` e `test-pdf`.

### Onboarding guiado

`#modalOnboarding` é um wizard de 3 passos que **faz** em vez de só ler. Disparado no fim de
`entrarNoApp()` (não mais em `carregar()` — o app precisa estar visível atrás do modal, e
`#telaInicial` z 1000 cobria o modal z 900). `onbPasso` (1-3) + `onbAtivo` (flag) são session
`let`. `renderOnboarding()` troca o conteúdo de `#onbConteudo`:
- **Passo 1** — 2 campos inline (`#onbContaNome` + `#onbContaSaldo`, `parseValorBR`) →
  `onbCriarConta()`: `contas.push` + `saldosIniciais` + `salvarContas()`, sem abrir o
  `#modalContas` por cima.
- **Passo 2** — esconde o wizard, abre o **`#modalRapido` existente** (`onbIrParaGasto()`,
  troca o texto do rodapé). **`fecharModalRapido()` é onboarding-aware:** enquanto
  `onbAtivo && onbPasso===2`, QUALQUER forma de fechar o rápido (×, `salvarRapido`) chama
  `onbVoltarModal()` → passo 3. Nunca fica preso sem modal.
- **Passo 3** — texto sobre a Visão Geral → `concluirOnboarding(via)`:
  `setJSON(STORAGE_ONBOARDING, true)`, `mudarAbaPrincipal('geral')`, evento
  `onboarding_concluido` (`via: 'completo'|'pulado'`).
- Rodapé sempre: "pular este passo" (some no passo 3) + "pular tudo" (→ `concluirOnboarding`).

Flag: `STORAGE_ONBOARDING` (`onboardingVisto`) — a mesma de sempre; quem viu o onboarding
antigo tem `true` e nunca vê o novo. **Os testes que clicam `#btnEntrarApp` disparam o
wizard** — o helper de dispensa deles clica `.onb-rodape [onclick*="concluirOnboarding"]`
(pular tudo) antes de tentar um `button`. `test-onboarding` (24 checks).

### PWA / Service worker

`<head>` carries a `manifest` (inline data URI), `apple-touch-icon`, e as meta tags
mobile-web-app → o site é instalável (standalone).

**`sw.js`** (arquivo próprio no root — a **única** exceção ao arquivo único; CSS/JS seguem
inline no `index.html`, sem build). Descoberta: um SW **não** exige extrair CSS/JS — só um
`.js` num caminho estável. `sw.js` faz precache do `index.html` monolítico inteiro
(`CACHE = 'bolso-certo-<versão>'`, **bumpar junto com `APP_VERSION`** no mesmo commit).
Estratégia: navegação = **network-first** (online sempre pega HTML fresco e reabastece o
cache; offline cai pro último bom), demais same-origin = stale-while-revalidate. **CDNs
(Chart.js, jsPDF, GSI, PostHog) e `googleapis.com` NUNCA passam pelo SW** —
`if (url.origin !== self.location.origin) return`. O SW só cacheia arquivo estático, **nunca**
dado do usuário.

Registro no `index.html` (bloco antes da linha de boot): só com `location.protocol === 'https:'`
(ou `localhost`) e `!window.__ARTIFACT_RUNTIME` (flag setada no shim de `window.storage` quando
ele já existia — dentro do iframe dos Artifacts não há `sw.js`). Falha de registro é `.catch`
silencioso, nunca quebra o app.

**Atualização:** SW novo instala e fica em `waiting` (o `install` **não** faz `skipWaiting`).
`updatefound` + `statechange==='installed'` com controller presente → `mostrarFaixaAtualizar()`
mostra `#barraAtualizar` ("✨ Nova versão disponível · [Atualizar]", reusa `.barra-trial`).
Clicar → `postMessage('skip-waiting')` → SW novo assume → `controllerchange` → `location.reload()`
**uma vez** (guard `tinhaControllerNoBoot`: no 1º registro de sempre o `clients.claim()` também
dispara `controllerchange`, e aí não recarrega). Ignorar a faixa → atualiza sozinho no próximo
fechar-e-reabrir. Nunca recarrega sem ação do usuário.

`garantirVersaoAtual()` (o hack do `?v=timestamp`) ganhou um guard: **não** faz o
`location.replace` se `navigator.serviceWorker.controller` existe (o SW já garante HTML fresco).
Fica só como cinto-e-suspensório para a 1ª visita pós-deploy, antes do SW ativar.

**Deploy inalterado:** `git push` (o `sw.js` sobe junto). **Mirror inalterado:**
`cp index.html dashboard-financeiro.html` (o `sw.js` não é espelhado). `.nojekyll` no root
desliga o Jekyll (deploy mais previsível).

**Notificações:** o que existe hoje (`verificarNotificacoesPendentes` — avisa vencidas /
vencendo-hoje com o app **aberto**) não mudou. Push real (app fechado) exige backend → Fase 2.

`test-sw` (18 checks) sobe um servidor `http://localhost` de verdade (Node `http`) — contexto
seguro onde o SW registra. A suíte normal roda em `file://`, onde o guard impede o registro.

Fase 3 do plano de monetização envolve wrappar a PWA num **TWA** (Bubblewrap) para a Play
Store. Não iniciada.

### Accounts vs. categories

`contas` is a flat array of account **names** (strings) — transactions reference accounts by
name (`t.conta`), never by object/id, so renaming an account silently orphans old transactions'
display. `contasDetalhes` is a separate, sparse map (`{nome: {tipo, diaFechamento,
diaVencimento}}`) holding extra config *only* for accounts marked as credit cards; most
entries in `contas` have no corresponding `contasDetalhes` entry.

`CATEGORIAS_PADRAO`/`CORES_PADRAO` hold the 12 built-in **expense** categories + their colours
— **immutable** (a stale import/sync may reference any of them). Every income transaction has a
fixed `categoria: 'Receita'` (the category dropdown is hidden for `tipo === 'receita'`), so
`'Receita'` — and `'Transferência'` — are added manually as extra options in `filtroCategoria`.
`CATEGORIAS`/`CORES` still exist as **aliases** of the `_PADRAO` constants for the little
legacy code that reads them directly (`PALPITE_CATEGORIA`); the UI never does — see below.

### Gerenciar categorias — user-editable category list

`categoriasUsuario` (`{adicionadas:[{nome,cor}], renomes:{Padrão:'Novo nome'}, ocultas:['Doação']}`)
is the user's personalization layer, wired through the **full state funnel** (top-level `let`,
`STORAGE_CATEGORIAS`, `carregar()`, `montarEstado()`, `aplicarDadosImportados()` — which merges
last-write-wins and already calls `popularSelectsEstaticos()`, so selects rebuild after sync;
also `salvarCategorias()` mirroring `salvarContas`). `normalizarCategoriasUsuario()` coerces any
blob into the shape and drops invalid entries (can't hide `'Outros'` or a non-padrão key).

**Derived functions — the UI never touches `CATEGORIAS`/`CORES` directly:**
- `categoriasAtivas()` → ordered visible expense categories: padrão (renamed, minus hidden) +
  `adicionadas`. Replaces `CATEGORIAS` in all 5 selects (`#categoria`, `#recCategoria`,
  `#filtroCategoria`, `#rapCategoria`, `orcEdit`) + the import modal + `editar()`.
- `corCategoria(nome)` (by **effective** name) → added colour → `CORES_PADRAO` → padrão-via-
  reverse-rename → `'#8b93a3'`. Replaces every `CORES[cat]` render point (table, donut,
  `renderParaOnde`, `renderOrcamentos`, PDF via `pdfHexRgb(corCategoria(...))`).
- `proximaCorCategoria()` picks the next unused colour from `PALETA_CATEGORIA` (12 tokens,
  distinct from the padrão set, legible in both themes) — **auto-assigned**, no picker.

**Modal** `#modalCategorias` (entry `🏷️ Gerenciar categorias` in `#menuConfig`, `editable-only`;
picked up by `_sincronizarTravaScroll`'s observer automatically since it's in the initial HTML).
`renderListaCategorias()` lists each active category with colour dot, rename input, usage count
(`contarUsoCategoria` — tx + orçamento + recorrentes), delete `×` (not on `'Outros'`).
- **Rename** (`renomearCategoria`): updates `renomes`/`adicionadas`, then `reatribuirCategoria(de,para)`
  rewrites `t.categoria` in **`transacoes`**, `r.categoria` in **`recorrentes`**, and the key in
  **`orcamentos`** (summing if the target already had a limit) → saves each touched store.
- **Delete with usage** → `#categoriaMoverBox` asks for a destination category, `reatribuirCategoria`
  moves everything, then removes. **Delete a padrão** just pushes it to `ocultas` (never removed
  from `CATEGORIAS_PADRAO`) + clears its rename; delete an added one splices `adicionadas`.
- `selecionarCategoriaNoSelect()` injects a transient `"X (fora da lista)"` option when a
  transaction's category is hidden/long-renamed, so `editar()` never silently changes it.

Tested in `test-categorias` (37 checks): add shows in all selects + orçamento; rename preserves
the link in tx/orçamento/recorrentes + keeps the colour; delete-with-destination reassigns;
padrão-without-use hides (constant intact); `'Outros'` protected; `montarEstado` includes the
field; round-trip through `aplicarDadosImportados` keeps `adicionadas`/`ocultas`; `normalizar…`
tolerates junk.

**Confirmado em iPhone real (28/10/2026, informado pelo usuário; deployado como `.16`):** o `#modalCategorias`
é um modal novo com lista rolável (`max-height:90vh`), inputs de texto em `.cat-row`
(`display:flex`) e o `scrollIntoView` do `#categoriaMoverBox` — exatamente o perfil onde os
bugs sutis só apareceram em WebKit real na rodada de polimento (o `<input type=date>` levou 3
rodadas). Verificar no iPhone: (1) scroll dentro do modal com muitas categorias + trava do
`body`; (2) abrir "mover para" numa categoria com lançamentos e ver o box rolar pra dentro da
vista até os botões; (3) os inputs de renomear não transbordarem o card no flex row. O
headless cobre o fluxo lógico, não o layout nativo iOS — mesma regra do "critério de pronto"
para `<input>` nativo. Os botões "Ver pendentes/pagas" (Item A) e a linha "Próximo pagamento"
(Item B) são CSS/layout mais simples, risco menor, mas valem um olhar no mesmo passe.

### Credit card invoice cycle math

`calcularCicloFatura(diaFechamento, diaVencimento)` computes the currently-open billing cycle
for a card from just its closing/due day-of-month, clamping to the actual last day of shorter
months. Due date is assumed to fall in the month *after* closing when `diaVencimento <
diaFechamento`, same month otherwise. This is pure date arithmetic with no year-boundary
special-casing beyond normal `Date` rollover — if you touch it, re-verify with cases spanning
Dec→Jan and short months (Feb).

### `hojeISO()` = data LOCAL

`hojeISO()` monta `YYYY-MM-DD` com `getFullYear/getMonth/getDate` (local), **não** com
`toISOString()` (UTC): em UTC−3, das 21h à meia-noite o UTC já é o dia seguinte e uma conta que
vence hoje virava `vencido` / `mesAtual` pulava de mês. A única outra `toISOString` (carimbo de
`exportadoEm`) é só metadado — não mexer. Testado em `test-hoje-local` (relógio fixo 23:30 BRT).

### Avisos de vencimento (banner + notificação do navegador)

- **`contasParaAvisar()`** (perto de `proximoPagamento`) → `{hoje, proximos, atrasadas}`: só
  `tipo==='gasto'` + `status` pendente; `diasEntre(hoje, t.data)` = 0 / 1..`JANELA_AVISO_DIAS`(3) / <0.
  **Ignora o filtro de conta do topo** (lembrete não pode esconder conta). Atrasadas sem corte de 12
  meses (o "Ver" leva à lista do Item A, que já trata o histórico antigo). `avisosAtivos()` = o mesmo,
  filtrado pelas preferências.
- **Preferências** `avisosVencimento` (`{hoje, proximos, atrasadas}`, padrão tudo `true`), no funil
  completo de estado (`STORAGE_AVISOS`, `carregar`, `montarEstado`, `aplicarDadosImportados`,
  `normalizarAvisosVencimento` tolera blob antigo/lixo). Editadas no `#modalAvisos` (menu ⚙️ →
  "🔔 Avisos de vencimento", **sem** `editable-only`, funciona em readonly/bloqueado).
- **Banner** `#barraVencimentos` (zona global de barras, logo após `#barraAtualizar`; qualquer aba),
  desenhado por `renderBarraVencimentos()` chamada de **`render()`** (muda ao marcar como pago).
  Âmbar (`urgente`) com atrasada/hoje, neutro só com próximos. Texto via `textContent`. **Ver**
  (`verContasAvisadas`) *força* `visaoContas='pendente'` (não alterna, ao contrário de
  `alternarVisaoContas`), liga `visaoContasMes=true` (só as pendentes do **mês selecionado**, sem corte
  de 12 meses; `let` de sessão, fora do funil), abre Lançamentos e rola (rAF) até `#chipVisaoContas`.
  O chip diz "pendentes de {mês} · N de outros meses (ver todas)"; "ver todas" e o botão "Ver todas
  as pendentes" **ampliam** pra todos os meses em vez de desligar (`alternarVisaoContas` com
  `visaoContasMes` ativo). `limparVisaoContas`/`verVisaoContasAntigas`/`alternarVisaoContas` zeram o
  modo mês. Estado vazio no modo mês: "Nenhuma conta pendente em {mês}". O **banner continua contando
  todos os meses** (`contasParaAvisar` não mudou).
- **Dispensar (✕)**: `localStorage` `bc_aviso_venc_dispensado` = `{dia, ids}`, **fora** do funil de
  sync (por aparelho). Oculto se `dia===hoje` e todos os ids atuais ∈ `ids`; reaparece no dia seguinte
  ou com conta nova na janela; marcar como paga **não** reabre.
- **Notificação do navegador** (`verificarNotificacoesPendentes`) agora usa as mesmas regras e
  preferências: uma `Notification` por tipo ligado com contagem > 0. **Mudança de comportamento:**
  antes contava receita pendente como "conta vencida"; agora só gastos. `#btnNotif` não existe mais —
  o status (ativado/negado) vive no `#modalAvisos`.
- Sem evento de telemetria novo. Testes: `test-avisos-vencimento` (33 checks).
- **Confirmado em iPhone real (.21), informado por Thamires:** `#modalAvisos` (checkbox/labels, scroll),
  o banner com as 3 barras empilhadas (trial + atualizar + vencimentos) e o **Ver** (rola até a lista,
  só as pendentes do mês selecionado, "ver todas" no chip, seletor de mês, ✕). O headless não cobre o
  layout nativo iOS — esta confirmação é a que vale.

### History start marker

`HISTORICO_INICIO` (`'2026-07'`, a `YYYY-MM` string near the top of the script) is the zero
point for every rolling-average / trend calculation — the user only started entering complete
data then, and earlier months had missing income that dragged projections down. Anything that
looks back N months clips the window to `>= HISTORICO_INICIO` and divides by the number of
months **actually in the window**, not a fixed N: `renderProjecaoSaldo()`'s base average,
`mediaCategoriaUltimosMeses()`, and `renderChartMes()` ("Últimos 6 meses" — shows fewer bars
early on). If you add another look-back, clip it the same way. Note the current system date in
the harness is 2026-09-01, so `diaHoje` is 1 — the early-month guard in `renderDobraSaldo`
always fires in tests; the full "runs out day X" projection is only reachable past day 5.

### Balance projection (Análise tab)

`renderProjecaoSaldo()` draws a line chart projecting the running account balance from *now*
to December of the current year (minimum 3 months). It lives in the **Análise** sub-tab now
(moved from Lançamentos > Dicas, which keeps only the textual tips + a pointer to Análise).
The chart build is guarded by `subAbaGeral === 'analise'` (see the sub-tabs section); the
text/data path always runs because `renderDicas()` consumes its return value. The line's
anchor point is either:

- **Sum of `saldoAtualConta()`** across accounts with a `saldosIniciais` entry, when any exist
  (see "Livre para gastar" section — only effectivated movements up to today count).
  `partidaReal` is true.
- Otherwise: the current real month's `receita − gasto` result. `partidaReal` is false, and
  the summary text nudges the user to enter their per-account starting balances.

Each projected month adds its estimated surplus/deficit: posted income/expenses when present,
otherwise the base average (up to 3 closed months since `HISTORICO_INICIO`, divided by how
many exist), plus already-registered installments, fixed bills, and not-yet-launched recurring
items. `partidaReal` is returned so `renderDicas()` can word the "projection goes negative"
tip correctly. This is an estimate, not a ledger.

### Currency: display-only conversion

Every amount is entered and stored in BRL. `moedaAtual` only affects `fmt()`, which multiplies
by `taxasCambio[moedaAtual]` before formatting — it does not touch stored data. Rates come from
`frankfurter.app` (no API key, cached 24h in `window.storage` under `cambioCache`), fetched in
`carregarCotacoes()`. This call is CORS-blocked when the file is opened via `file://`; it only
succeeds on the deployed `https://` origin. CSV **and PDF** exports intentionally always write
raw BRL values regardless of `moedaAtual`, to avoid ambiguous exported files — they call
`fmtBRL()` (not `fmt()`).

### Relatórios PDF (mensal + anual)

`exportarPDF()` / `exportarPDFAnual()` — jsPDF 2.5.1 UMD, **no autoTable plugin** (tabela é
desenhada à mão). Sistema visual compartilhado que espelha os tokens do app: `PDF_COR`
(azul/verde/vermelho/âmbar nas versões de contraste-em-papel), `pdfLogo()` (cofrinho da marca
em vetor), `pdfCabecalho()` (marca + referência + "Gerado em"), `pdfRodape()` (numeração
"Página X de Y" em todas as páginas, aplicada no fim via `getNumberOfPages()` + `setPage()`),
`pdfResumoMes()` (Resultado como número-herói colorido + frase humana + Entrou/Saiu
secundários + taxa de poupança + a linha "somando o que sobrou/faltou de {mês ant.}" na mesma
voz do card "Este mês"), `pdfTabelaHeader()` / `pdfLinhaLancamento()` (zebra, chip de
categoria com `CORES[cat]` a 15% via `GState`, valor colorido por tipo), `pdfTruncar()`
(reticências por largura real). Quebra de página re-imprime cabeçalho + header da tabela.
`jspdf.jsPDF.prototype.save` **não** intercepta nos testes — `save` é own-property da
instância em 2.5.1; o `test-pdf` faz spy no construtor. Arquivos ficam leves (~15 KB mês
típico, ~75 KB com 50 lançamentos) porque não há fonte embutida — Helvetica com
peso/tamanho/cor para hierarquia. `test-pdf` (25 checks): 1 página / múltiplas páginas /
mês vazio / anual, marca e rodapé presentes, tamanho.

### Cache-busting

`APP_VERSION` (top of the script) is compared against `sessionStorage` on load; a mismatch
triggers one automatic `location.replace` with a `?v=timestamp` cache-buster, because mobile
browsers were observed serving stale cached HTML after deploys even with the `no-cache` meta
tags also present. **Bump `APP_VERSION` whenever shipping a change users need to see
immediately** (not required for backend-only fixes with no visible behavior change). **Também
bumpar `CACHE` em `sw.js` no mesmo commit** — é o que faz o service worker detectar a versão
nova, precachear o HTML novo e apagar o cache antigo. Com o SW ativo, o `?v=timestamp` não
dispara (guard em `garantirVersaoAtual`); o `sw.js` cuida do cache-busting.

### PIN lock

Client-side only (`STORAGE_PIN`), gates the UI (`telaPin` overlay) but not the underlying data —
it does not encrypt `window.storage` or the Drive file. Treat it as a screen lock, not real
access control.

## Rodada de polimento mobile (3 commits, deployados juntos como `2026-09-02.10`)

`aafd785` (auditoria visual) + `1d00f5a` (modal Contas no iPhone) + `f124466` (mais overflow
mobile) subiram juntos em **03/09/2026** — `origin/main` = `f124466`, versão `.10`. Tudo
CSS/layout + alguns atributos/classes de HTML; **nenhuma lógica de dados/cálculo/estado
tocada**. As 3 seções abaixo detalham cada commit. **Confirmado no iPhone real (28/10/2026):** itens
do usuário (faixa "Nova versão disponível", campo de data com legenda, modal sem vazar,
frase da dobra, campos de anexo/backup, campo de data em Metas) + K3 (emoji `📈`).

### Auditoria visual — 12 itens (`aafd785`)

Após a auditoria visual (406 combinações tela × breakpoint × tema), 12 problemas distintos
foram corrigidos numa passada só de CSS/layout — **nenhuma lógica de dados/estado tocada**.
Pontos que mudaram o comportamento visual e podem confundir uma sessão futura:

- **Todos os `.modal-box` agora têm `max-height:90vh; overflow-y:auto`** (antes só
  `#modalImportar` tinha controle de altura). Sem isto o `#modalContas` com várias contas
  transbordava a tela e escondia os botões "Adicionar conta"/"Fechar" no celular (confirmado
  no iPhone real). `#modalImportar` mantém seu layout flex-column próprio
  (`overflow-y:visible` + `#importLista` rola). `#modalEvolucaoMeta` é `overflow:visible`
  (tem um balão `.help-icon` no `<h2>` que o `overflow:auto` cortaria; conteúdo nunca
  transborda). **Ao criar um modal novo com balão de ajuda no topo, lembrar deste caso.**
- **O FAB some na aba Lançamentos** (`body[data-aba="lancamentos"] #fab{ display:none }`;
  `mudarAbaPrincipal` seta `document.body.dataset.aba`). O form "Novo lançamento" completo já
  está no topo dessa aba — o FAB era redundante e, no mobile com as faixas de trial/update,
  caía sobre um campo do form.
- **Alvos de toque:** a regra de 44px que só existia em `#corpoTabela` (≤599) foi estendida:
  `#metas`/`#recorrentes`/`#listaContas .iconbtn` (≤1023 → 44px; ≥40px sempre), `#corpoTabela
  .iconbtn` (600–1023, onde a lista ainda é `<table>`), `.modal-box h2 .iconbtn` (× de fechar,
  ≥40px sempre), `#btnConfig` (44×44). Os checkboxes de linha da tabela agora vêm dentro de
  `<label>` — a label é o alvo (24px desktop / 44px tablet), o `<input>` fica ~18px. O `<th>`
  de "selecionar todos" ganhou `class="col-check"`. Os links inline "Contas" nas frases de
  saldo (`renderLivreParaGastar`, `renderDobraSaldo`) ganharam `role="button" tabindex="0"`
  (antes eram clique-só); o handler global de teclado agora cobre `[role="button"]:not(button)`,
  não só `span[role="button"]`. Alvo inline dentro de frase é isento da regra de 44px (WCAG 2.5.8).
- **`.dobra-saldo` no estado vazio (mobile):** `.ds-topo` agora `min-width:0; flex:1 1 100%`
  e `.ds-valor` `overflow-wrap:anywhere`; `.ds-status` perdeu o `min-width:240px` em ≤560.
  Corrigia 69px de scroll horizontal no `body`.
- **Form "Novo lançamento" em 600–1023:** `#wrapLinhaExtra` quebra em coluna (parcelas /
  etiqueta / comprovante), como já fazia em ≤599.
- **`renderMetas`:** os botões do cartão de meta agora estão em `<span class="meta-acoes">`
  (nunca quebram com o × órfão); `.meta-top` ganhou `gap` + `align-items:baseline` (título
  não encosta mais no `%`). O `📈` de "ver evolução" segue emoji — **confirmar em navegador
  real** que renderiza (aparece quebrado só no msedge headless, sem fonte de emoji).
- **`renderParaOnde`:** no estado vazio agora limpa `#paraOndeLista` (`''`) — a mensagem
  aparece só uma vez, dentro da área do gráfico (`#chartCatVazio`). Antes duplicava.
- **`.mes-valor` (mobile):** `white-space:nowrap`; `.mes-label` pode quebrar em 2 linhas —
  R$ 999.999,99 não corta mais na grade "Este mês" em ≤430.
- **`.orc-nota`:** sem o `·` literal entre os spans (ficava pendurado ao quebrar) — só `gap`.
- **Gráfico "Projeção de saldo":** eixo Y ganhou `grace:'12%'` (evita rótulo repetido quando
  o range é estreito frente à magnitude).

**Fora de escopo (não são bug):** overflow da `#telaInicial` (pré-existente, ver abaixo);
espaço vazio nas laterais em telas ≥1600px (decorrência do `.wrap` max-width 1120,
decisão mobile-first — só muda se a decisão de produto mudar).

**Verificação:** re-rodada a auditoria visual (406 combos) → **0 crítico / 0 moderado /
0 cosmético**, 406/406 limpos (era 94/406).

**Confirmado em aparelho real (K3, 28/10/2026):** o emoji `📈` do botão "ver evolução" da
meta — **não foi investigado nem corrigido**, só ganhou `aria-label`. Aparece quebrado só no
headless (sem fonte de emoji); provavelmente ok em uso real. Se estiver quebrado num
navegador/celular normal, trocar por um ícone de traço.

### Modal Contas — 2 defeitos de iPhone real (`1d00f5a`)

Dois defeitos vistos num iPhone (Safari **e** Chrome iOS — ambos WebKit) que o headless não
reproduz. **Contexto:** o site em produção estava em `.8` (sem a rodada da auditoria), então
o usuário ainda pegava o modal sem `max-height` — os 2 abaixo entraram junto no mesmo deploy.

- **Campo de data ("em [___]") aparecia vazio, sem placeholder.** Causa: `<input type="date">`
  no WebKit iOS **não mostra nenhum placeholder textual** quando `value` está vazio (Chromium
  desktop mostra "dd/mm/aaaa"; iOS não mostra nada, e `placeholder` é ignorado nesse tipo de
  campo). CSS de tamanho não resolve — não há conteúdo. **Solução:** `renderListaContas`
  agora envolve cada campo em `<label class="conta-campo">` com uma **legenda visível**
  (`.campo-legenda`) acima: "Saldo inicial" / "Data do saldo". Funciona vazio ou preenchido.
  O `em` solto foi removido. `font-size:16px` mantido (anti-zoom iOS) + `box-sizing` +
  `min-width:0` + `max-width:100%` pro controle nativo nunca vazar do card.
- **Fragmento de texto ("...tas") vazando na borda direita, de um elemento atrás do modal.**
  Causa: `.modal-bg` é `position:fixed` mas translúcido, e **não havia trava de scroll** —
  no iOS dava pra arrastar a página por trás e ver nav/filtros vazando pelas bordas.
  **Solução:** `_sincronizarTravaScroll` (script, perto do handler de `[role=button]`) — um
  `MutationObserver` no `style` de cada `.modal-bg` + `#telaPin`; quando algum vira
  `display:flex`, põe `body.modal-aberto` (`position:fixed; width:100%; overflow:hidden` +
  `top:-Ypx` guardando a posição), reposta ao fechar todos. **Zero mudança nas ~20 chamadas
  de abrir/fechar** — o observer cobre todas. `.modal-bg` também ganhou `overflow:hidden`.
  A trava aplica ~1 frame depois (observer é assíncrono) — imperceptível.

`test-modal-contas` (novo, 61 checks): legendas presentes/visíveis/acima do input em 4
viewports; input de data ≥16px e dentro do card; sem scroll-x com o modal aberto; nada vaza;
body trava ao abrir e destrava + repõe scroll ao fechar; transição onboarding→rápido mantém
a trava sem flicker.

### Mais overflow no mobile — frase da dobra + inputs de arquivo e de data (`f124466`)

Depois do commit acima, o usuário achou mais pontos de overflow no celular que o headless
(Chromium) não pega porque renderiza controles nativos menores que o WebKit iOS:

- **Faixa "Você tem hoje" / "Resultado do mês" (`.dobra-saldo`):** a frase de apoio
  `#dsSub` ("Estimativa do mês. Informe o saldo das contas para o valor exato.") ditava a
  largura da `.ds-topo` (`flex:0 0 auto`, sem `max-width`) e vazava. Correções:
  `.ds-topo{ flex:0 1 auto; min-width:0; max-width:100% }`; `.ds-sub{ overflow-wrap:break-word }`;
  a faixa passa a **empilhar** (topo em cima full-width, status embaixo) em **≤700px** (era
  ≤560) — pega celular grande e celular deitado. Copy encurtada. `test-dobra` #2 virou
  case-insensitive (`/informe o saldo/i`).
- **Inputs de arquivo (`<input type="file">`):** no iOS o botão "Escolher arquivo" +
  "Nenhum arquivo" tem largura mínima intrínseca enorme que ignora `flex-shrink`. As labels
  que os envolvem ("Importar backup:" no `#painelBackup`, "Comprovante:" no form) ganharam
  `class="chk-arquivo"` → `flex-direction:column` (texto em cima, input embaixo `width:100%`).
  Vale pra qualquer `label.chk` nova com file input.
- **Inputs de data (`<input type="date">`):** a regra global virou
  `input[type=date]{ min-width:132px; max-width:100%; flex:1 1 132px }` — em qualquer `.row`
  o campo **cresce** pro tamanho real do iOS (~190px) quando há espaço e **quebra pra própria
  linha** quando não há, em vez de ser espremido abaixo do conteúdo do controle nativo.
  `#dataInput` (Vencimento), `#periodoDe`/`#periodoAte` (filtro de período) e `#metaPrazo`
  (prazo da meta) perderam os `style` inline de largura fixa / `flex:none` que impediam isso.

**A auditoria visual agora simula a largura iOS:** `MEDIR()` no `audit-visual.js` tem uma
checagem (#6) que, pra cada `<input type=date|file>`, testa se a linha transbordaria SE o
input tivesse a largura real do iOS (date ~190px, file ~250px) — a defesa aceita é o input
poder encolher (`max-width:100%`) OU a label quebrar em coluna. Foi assim que `#metaPrazo`
apareceu depois que `.dobra-saldo`/backup foram corrigidos.

**Lição pro futuro:** o Chromium headless **não vê a largura real de `<input type="date">` e
`<input type="file">` no iOS** (ambos WebKit, muito mais largos). Ao mexer em qualquer linha
com esses controles no mobile: garantir que o input tem `flex:1 1 <base>; max-width:100%` OU
que a label quebra em coluna — e conferir que a checagem #6 do `MEDIR()` passa.

**Verificação das 3 rodadas:** suíte completa **19 scripts / ~662 checks, 2 fail** (só o
`test-dobra` CASO 4 dependente da data — confirmado idêntico no `main` limpo). Última
auditoria visual completa (v6): **0 crítico / 0 cosmético**; o único moderado (`#metaPrazo`)
foi corrigido e re-checado. As ~80 telas de desktop da v7 não foram até o fim (canceladas —
overflow de input iOS não acontece em desktop largo), mas m360/m390/m430 + todo o tablet
(~330 combos) rodaram sem nenhum achado.

`APP_VERSION`/`CACHE` → `2026-09-02.10` (deployado 03/09/2026).

### Campo de data no `#modalContas` maior que o "Saldo inicial" — regressão da legenda

**Regressão introduzida por `1d00f5a`** (a legenda "Data do saldo" acima do campo). Vista num
iPhone 12 real: o `<input type="date">` de "Data do saldo" primeiro com ~132px de altura
(caixa gigante), depois — pós correções — ainda mais alto **e** mais largo que o "Saldo
inicial" ao lado (que tem altura/largura normais). Precisou de **3 rodadas**, cada uma guiada
por screenshot de iPhone real — o Chromium headless **não reproduz** o `<input type="date">`
do WebKit iOS: renderiza altura/largura diferentes e respeita `height`/`width` que o iOS
ignora. Ver **regra geral** no fim desta seção.

Causa: a legenda passou a envolver cada input num `<label class="conta-campo">` que é
`display:flex; flex-direction:column`. As regras **globais** de input têm `flex` setado
(`input[type=text]{flex:1}`, `input[type=date]{ flex:1 1 132px }` — pensadas pra crescimento
**horizontal** dentro de `.row`). Num container `flex-direction:column`, o `flex` passa a
valer no **eixo vertical**: o `flex-basis:132px` do input de data virou **altura de 132px** e
o `flex-grow:1` ainda esticava mais. O `#modalContas input[type=date]{ min-height:40px }` do
mesmo commit era um piso, não um teto — não segurava os 132px.

**Correção em 2 rodadas** (headless não reproduz nem a altura nem a largura reais do
`<input type="date">` no WebKit iOS — as duas rodadas dependeram de screenshot de iPhone real):

- **`78f343c`:** `flex:none; height:auto; min-height:40px` no `#modalContas .conta-campo
  input` — mata o `flex-basis:132px` que virava altura. Resolveu os 132px mas no iPhone real o
  campo de data ainda ficava ~2x mais alto que "Saldo inicial" (`height:auto` deixa o iOS usar
  a altura intrínseca do controle nativo, maior que a de um `input[type=text]`) **e** mais
  largo (com `.conta-campo{ flex:1 1 140px }`, a largura intrínseca grande do date no iOS
  furava o `flex-basis` e roubava espaço do "Saldo inicial").
- **2ª rodada (`.12`):** duas mudanças que resolveram no Chromium mas **não** no iPhone:
  - `.conta-campo{ flex:1 1 0; width:0; min-width:0 }` (era `flex:1 1 140px`) → 50/50 na linha.
  - input: `height:42px; min-height:42px; max-height:42px` (era `height:auto`) → altura fixa.
- **3ª rodada (`.13`):** o que faltava era mexer no **controle nativo do WebKit** (WebKit Bug
  198959) — `height` sozinho é ignorado pelo iOS. Regras novas, só `#modalContas .conta-campo
  input[type=date]`:
  - `-webkit-appearance:none; appearance:none` — remove as restrições de tamanho do controle.
  - `::-webkit-datetime-edit*` (e `-fields-wrapper`, `-text`, `-day/-month/-year-field`):
    `padding:0; line-height:1.2` — zera o padding interno dos pseudo-elementos, que era a
    origem da altura extra.
  - `::-webkit-calendar-picker-indicator{ margin:0; padding:0; width:16px; height:16px }` —
    encolhe o ícone do calendário (reservava largura/altura).
  - `::-webkit-inner-spin-button{ display:none }`.
  Com os pseudos zerados, a altura vem do `padding:9px 10px` do próprio input (herdado da
  regra global) — igual ao `input[type=text]` ao lado. `-webkit-appearance:none` **não**
  impede o date picker de abrir no tap (isso é nativo do iOS, imune a CSS).

A legenda **não** foi mexida em nenhuma das rodadas. `_sincronizarTravaScroll` e o resto de
`1d00f5a`/`f124466` intocados.

`#dataInput`, `#periodoDe`/`#periodoAte`, `#metaPrazo` **não** têm o bug: ficam em `label.chk`
(`flex-direction:row`, `align-items:center`) ou direto na `.row` — lá o `flex:1 1 132px` é
horizontal, como projetado. Só o `.conta-campo` é `flex-direction:column`.

`test-modal-contas` **61 → 73 checks**: +12 medindo altura E largura do input de data vs. o
`input[type=text]` "Saldo inicial" ao lado (±6px cada) + teto de altura < 70px, em 4 viewports.
Os checks de altura falham no `main` pré-`78f343c` (data=132 vs texto=41). **Limitação
conhecida:** os checks passam em headless desde a 2ª rodada — o Chromium já mostrava os campos
iguais quando o iPhone ainda não. Valem como guard de regressão grosseira (a caixa de 132px) e
de intenção, **não** como prova de que está certo no iOS. A prova é screenshot de iPhone real.
Suíte completa: 19 scripts, 2 fail (só `test-dobra` CASO 4, data-dependente). Auditoria visual
completa (`audit-visual.js`, 406 combos): 0 crítico / 0 moderado / 0 cosmético (mesma ressalva
— não vê o controle nativo de data do iOS).

`APP_VERSION`/`CACHE` bumpado a cada rodada que foi pro ar: `.11` (1ª) → `.12` (2ª) → `.13`
(3ª). Cada uma já tinha sido vista num iPhone, então o SV de quem instalou só pega a próxima
com um `CACHE` novo. **Confirmado no iPhone real (28/10/2026).**

**Regra geral — `<input type="date">` (e `time`, `month`) no iOS/WebKit:** o Chromium headless
(a suíte E o `audit-visual.js`) **não é fonte confiável** pra altura/largura desses campos —
renderiza diferente do WebKit iOS e respeita `height`/`width` que o iOS ignora (WebKit Bug
198959). Pra igualar a um `input[type=text]` no iOS **não basta** `height`/`min-height`: precisa
de `-webkit-appearance:none` **+** `padding:0` nos pseudo-elementos `::-webkit-datetime-edit-*`
**+** encolher `::-webkit-calendar-picker-indicator`. **No "critério de pronto" de qualquer item
visual que toque um `<input>` nativo (date/time/file/select), exigir um screenshot real de iOS
Safari antes de fechar** — a auditoria headless não pega essas regressões (custou 3 rodadas de
commit→push→teste-no-iPhone aqui).

## Known pre-existing issues (candidates for a future round, not regressions)

- **`#telaInicial` opening screen overflows ~39px horizontally.** Predates the whole UX round
  (confirmed by stashing). It's the opening overlay, outside the app breakpoint tests.
- **Pull-to-refresh** was scoped out of the microinteractions item (touch-event risk right
  after stabilizing scroll/bottom-bar; benefit limited to Drive users). Would be its own
  isolated item.
- **Trial state is bypassable via DevTools** — only closes with the Fase 2 backend (by design
  for Fase 1).
- **No merge logic in Drive sync** (last-write-wins on the whole file). The couple/family mode
  in the monetization plan needs per-item merge first.
