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

There **is** a test suite now — a set of standalone Playwright scripts kept in the session
scratchpad (not committed; they drive `index.html` over `file://`). They are the real
verification that a change works, and every change in the UX rounds was gated on them staying
green. As of the last round there are ~315 checks across:

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

Harness notes: `playwright-core` (not full `playwright`) with the `msedge` channel works
headless. Load over `file://`, then dismiss `#btnEntrarApp` and `#modalOnboarding`. `file://`
disables CORS features (Google sign-in, currency API) — those only work on the deployed
`https://` origin. Script-scoped `let`s are reachable from `page.evaluate()` as bare globals,
so `montarEstado()` / `aplicarDadosImportados()` / `render()` can be called directly. Values
that animate (`fmtValorAnimado`) need a ~300–600ms wait before reading `.textContent`, or read
`el.dataset.valor` (the target). The bottom bar's `getBoundingClientRect().bottom` has a ~18px
quirk in msedge headless — the bar renders flush; measure via `offsetHeight` / distance-from-
bottom instead. See the browser-test-harness memory for a ready scaffold.

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
  `parseValorBR` (BR e US). Descrição: `NAME` ou `MEMO`. Encoding: se `arquivo.text()` gerou
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

**`rastrear(evento, props)`** ([index.html](index.html), junto de `hojeISO()`) é o ponto
ÚNICO. Contrato: falha em silêncio (sem PostHog / não inicializado / ad-blocker → nada, sem
throw, sem log); **não dispara** com `?readonly=1` na URL; `props` só aceita as chaves de
`RASTREAR_PROPS_OK` (`['dias_de_trial','via']`) e só primitivos. O `distinct_id` (UUID
aleatório no `localStorage`, gerado pelo próprio SDK) é o único identificador — não é dado
pessoal; habilita a métrica de retenção.

Eventos e onde disparam: `sessao_iniciada` (fim de `carregar()`), `trial_iniciado`
(`carregarAssinatura()`, no `if` que grava `trialInicio` pela 1ª vez), `trial_expirado`
(`rastrearTrialExpiradoUmaVez()` em `avaliarAssinatura()` quando bloqueia — flag
`localStorage` `bc_tel_expirado`, **fora** do funil de sync, 1x por aparelho),
`assinar_clicado` (`assinarProvisorio()`), `continuar_consultando_clicado`
(`continuarSoConsultando()`), `lancamento_criado` (`adicionar()` não-edição, transferência, e
`salvarRapido()` — só o fato, com `via`), `extrato_importado` (`confirmarImportacao()`,
`via: 'ofx'|'csv'`).

Linha de privacidade adicionada ao `#modalOnboarding` e ao `#modalPlanos`. **Não existe
documento formal de política de privacidade** — pendência registrada. Painel: posthog.com →
Funnels (`trial_iniciado` → `trial_expirado` → `assinar_clicado`) e Retention
(`sessao_iniciada`). Testado em `test-telemetria` (21 checks, PostHog stub sobre `file://`,
`?v=1` na URL evita o `location.replace` de cache-busting que senão zera o stub).

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
when a date-range filter or the search box has a value, the table switches to querying all of
`transacoes` instead of just `mesAtual` (see the `periodoAtivo` / `buscaAtiva` branch in
`render()`). Don't extend the wider-range behavior to the KPI cards — that would break the
month-relative math.

### Installments vs. recurring items — different data shapes

- **Installments** (`parcelas > 1` on the transaction form): pushes N separate transactions
  upfront, sharing a `grupoParcela` id, each dated one month apart (`addMeses`). The amount
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

The two answer different questions on purpose (how much I *have* / how much *is left after
paying what's due*) — kept visually distinct: band is blue, headline is green/red.
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
(`#menuConfig`, `toggleMenuConfig`) holds "Minha assinatura", PIN, currency, notifications,
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
entries in `contas` have no corresponding `contasDetalhes` entry. `CATEGORIAS`/`CORES` are
fixed constants, not user-editable data — they aren't persisted per-user.

`CATEGORIAS` holds **expense** categories only. Every income transaction has a fixed
`categoria: 'Receita'` (the category dropdown is hidden for `tipo === 'receita'`), so
`'Receita'` — and `'Transferência'` — are added manually as extra options in `filtroCategoria`
(the Lançamentos category filter) on top of `CATEGORIAS`.

### Credit card invoice cycle math

`calcularCicloFatura(diaFechamento, diaVencimento)` computes the currently-open billing cycle
for a card from just its closing/due day-of-month, clamping to the actual last day of shorter
months. Due date is assumed to fall in the month *after* closing when `diaVencimento <
diaFechamento`, same month otherwise. This is pure date arithmetic with no year-boundary
special-casing beyond normal `Date` rollover — if you touch it, re-verify with cases spanning
Dec→Jan and short months (Feb).

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
