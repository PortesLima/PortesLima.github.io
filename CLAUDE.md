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

## Commands

There is no build, lint, or test tooling — this is intentional (see Architecture). Workflow:

```bash
# Syntax-check the inline <script> block after editing (Node has no HTML parser,
# so extract the script content first):
node -e "
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
fs.writeFileSync('/tmp/script_0.js', matches[0][1]);
"
node --check /tmp/script_0.js

# Keep the mirror file in sync before every commit:
cp index.html dashboard-financeiro.html

# Publish: commit + push to main — GitHub Pages redeploys automatically (~1-2 min)
git add dashboard-financeiro.html index.html
git commit -m "..."
git push origin main
```

To actually exercise a change (not just check syntax), open `index.html` locally with a
headless browser (e.g. Playwright) and drive the UI — there's no test suite, so this is the
only way to verify behavior. Opening via `file://` will fail CORS-dependent features (Google
sign-in, the currency API); those only work over `https://` on the published site.

## Architecture

**Single HTML file, single `<script>` block, no modules.** All state lives in top-level `let`
variables (`transacoes`, `orcamentos`, `contas`, `metas`, `recorrentes`, `contasDetalhes`,
`saldoContas`, `moedaAtual`, etc.) mutated directly by event handlers, then persisted and
re-rendered — there
is no framework, no virtual DOM, no reactivity system. Every UI update goes through one
function, `render()`, which recomputes everything (KPIs, charts, tables, alerts) from the
in-memory state and month/period filters currently selected in the DOM.

### Persistence: three layers, always in this order

1. **`window.storage`** (`getJSON`/`setJSON` helpers) — a key-value API assumed to be provided
   by the Artifacts runtime. This is per-device/per-browser and is the only storage that works
   offline.
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
cross-device bugs in this app.

### Auth: token renewal without a backend

Google Identity Services (`google.accounts.oauth2.initTokenClient`) issues short-lived
(~1h) access tokens with no refresh token in this client-only flow. `renovarTokenSilenciosamente()`
requests a new token with `prompt: ''` (no popup) whenever a 401 is hit or a session opens; a
50-minute proactive timer (`agendarRenovacaoToken`) does the same before expiry. Any new
authenticated Drive call should go through `driveApi()`, which already handles the 401 →
silent-renew → retry-once path — don't call `fetch` against the Drive API directly.

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

### Accounts vs. categories

`contas` is a flat array of account **names** (strings) — transactions reference accounts by
name (`t.conta`), never by object/id, so renaming an account silently orphans old transactions'
display. `contasDetalhes` is a separate, sparse map (`{nome: {tipo, diaFechamento,
diaVencimento}}`) holding extra config *only* for accounts marked as credit cards; most
entries in `contas` have no corresponding `contasDetalhes` entry. `CATEGORIAS`/`CORES` are
fixed constants, not user-editable data — they aren't persisted per-user.

### Credit card invoice cycle math

`calcularCicloFatura(diaFechamento, diaVencimento)` computes the currently-open billing cycle
for a card from just its closing/due day-of-month, clamping to the actual last day of shorter
months. Due date is assumed to fall in the month *after* closing when `diaVencimento <
diaFechamento`, same month otherwise. This is pure date arithmetic with no year-boundary
special-casing beyond normal `Date` rollover — if you touch it, re-verify with cases spanning
Dec→Jan and short months (Feb).

### Balance projection (Dicas tab)

`renderProjecaoSaldo()` draws a line chart projecting the running account balance from *now*
to December of the current year (minimum 3 months). The line's anchor point is either:

- **`saldoContas`** (`{valor, em}` — a total-account-balance figure the user types once in the
  *Contas* modal, stamped with the date entered), adjusted by transactions dated between `em`
  and today. Future transactions are excluded from that adjustment — they're already counted
  in the projected months ahead, so including them would double-count. `partidaReal` is true.
- If `saldoContas` is null: the current real month's `receita − gasto` result. `partidaReal`
  is false, and the summary text nudges the user to enter their real balance.

Each projected month adds its estimated surplus/deficit: posted income/expenses when present,
otherwise the 3-closed-month average, plus already-registered installments, fixed bills, and
not-yet-launched recurring items. `partidaReal` is returned so `renderDicas()` can word the
"projection goes negative" tip correctly. This is an estimate, not a ledger.

### Currency: display-only conversion

Every amount is entered and stored in BRL. `moedaAtual` only affects `fmt()`, which multiplies
by `taxasCambio[moedaAtual]` before formatting — it does not touch stored data. Rates come from
`frankfurter.app` (no API key, cached 24h in `window.storage` under `cambioCache`), fetched in
`carregarCotacoes()`. This call is CORS-blocked when the file is opened via `file://`; it only
succeeds on the deployed `https://` origin. CSV export intentionally always writes raw BRL
values regardless of `moedaAtual`, to avoid ambiguous exported files.

### Cache-busting

`APP_VERSION` (top of the script) is compared against `sessionStorage` on load; a mismatch
triggers one automatic `location.replace` with a `?v=timestamp` cache-buster, because mobile
browsers were observed serving stale cached HTML after deploys even with the `no-cache` meta
tags also present. **Bump `APP_VERSION` whenever shipping a change users need to see
immediately** (not required for backend-only fixes with no visible behavior change).

### PIN lock

Client-side only (`STORAGE_PIN`), gates the UI (`telaPin` overlay) but not the underlying data —
it does not encrypt `window.storage` or the Drive file. Treat it as a screen lock, not real
access control.
