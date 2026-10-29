// Trial e assinatura (Fase 1, sem gateway) — fronteiras do teste de 15 dias, soft-block (body.readonly),
// o que bloqueia / o que continua, "Assinar" provisório, telemetria 1x só, sync entre aparelhos.
// Caracteriza o comportamento ATUAL. Convenções de nome dos checks:
//   [BUG-CONHECIDO]    comportamento de hoje que parece errado (afirma o resultado atual)
//   [PROVISORIO-FASE2] comportamento que só vale na Fase 1 (sem backend/cobrança): quando a Fase 2
//                      entrar, estes checks FALHAM DE PROPÓSITO e mostram o que reescrever
// Relógio fixo; PostHog substituído por um stub em memória (nada vai à rede); sem waitForTimeout.
const path = require('path');
const { chromium, ok, bloquearPosthog, res } = require('./lib');
const URLAPP = require('url').pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href + '?v=1';
const FIX = '2026-09-10T12:00:00-03:00'; // hoje = 2026-09-10
const eq = (a, b, n) => { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, A === B ? n : `${n}  [obtido ${A} | esperado ${B}]`); };

// Abre o app com relógio fixo e storage limpo (contexto novo). `assin`: objeto semeado em
// bc_assinatura, {raw:'...'} para texto cru, ou undefined (primeira abertura de sempre).
// O stub de posthog registra rastrear() em window.__ev (a tag do SDK é pulada porque __SV existe).
async function abrirT(browser, { fixed = FIX, assin, query = '', extraInit = '' } = {}){
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, timezoneId: 'America/Sao_Paulo' });
  await bloquearPosthog(ctx);
  const page = await ctx.newPage();
  page.__erros = [];
  page.on('pageerror', e => page.__erros.push('pageerror: ' + e.message));
  page.__dialogos = [];
  page.on('dialog', d => { page.__dialogos.push(d.message()); d.accept(); });
  if(fixed) await page.clock.setFixedTime(new Date(fixed));
  const semear = assin === undefined ? '' : `localStorage.setItem('bc_assinatura', ${JSON.stringify(assin && assin.raw !== undefined ? assin.raw : JSON.stringify(assin))});`;
  await page.addInitScript(`(function(){
    window.__ev = [];
    window.posthog = { __SV: 1, __loaded: true, init: function(){}, capture: function(n, p){ window.__ev.push([n, p || null]); } };
    if(!localStorage.getItem('bc_t_semeado')){ localStorage.setItem('bc_t_semeado', '1'); localStorage.setItem('bc_onboardingVisto', 'true'); ${semear} }
    ${extraInit}
  })();`);
  await page.goto(URLAPP + query, { waitUntil: 'load' });
  await page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => getComputedStyle(document.getElementById('telaInicial')).display === 'none');
  return { ctx, page };
}
const estado = (page) => page.evaluate(() => {
  const d = id => { const e = document.getElementById(id); return e ? getComputedStyle(e).display : null; };
  const b = document.getElementById('barraTrial');
  return {
    status: assinatura.status, trialInicio: assinatura.trialInicio, assinouEm: assinatura.assinouEm,
    readonly: document.body.classList.contains('readonly'), trialBloqueado: document.body.classList.contains('trial-bloqueado'),
    barra: d('barraTrial') === 'none' ? null : b.querySelector('span').textContent.replace(/\s+/g, ' ').trim(), // só a frase (sem o botão "Ver planos")
    urgente: b.classList.contains('urgente'), aviso: d('avisoBloqueio'), modalFim: d('modalTrialFim'), planos: d('modalPlanos'),
  };
});
const evs = (page) => page.evaluate(() => window.__ev.map(e => e[0]));
const evsFull = (page) => page.evaluate(() => window.__ev);
const guardada = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('bc_assinatura')));
const contar = (lista, nome) => lista.filter(x => x === nome).length;
const sem = (dias) => { // trialInicio = hoje(FIX) − dias
  const d = new Date(2026, 8, 10 - dias); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const A = (trialInicio) => ({ status: 'trial', trialInicio, assinouEm: null });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const fechar = async (c) => c.ctx.close();

  // ================= 1. primeira abertura (dia 0) =================
  console.log('1. primeira abertura de sempre');
  let c = await abrirT(browser);
  let e = await estado(c.page);
  eq([e.status, e.trialInicio, e.assinouEm], ['trial', '2026-09-10', null], 'grava trialInicio = hoje (local), status trial');
  eq(await guardada(c.page), { status: 'trial', trialInicio: '2026-09-10', assinouEm: null }, 'persistido em bc_assinatura');
  let ev = await evsFull(c.page);
  eq(contar(ev.map(x => x[0]), 'trial_iniciado'), 1, 'trial_iniciado disparado 1x');
  eq(ev.find(x => x[0] === 'trial_iniciado')[1], { dias_de_trial: 15 }, 'trial_iniciado só leva dias_de_trial=15 (sem dado pessoal)');
  eq(ev.find(x => x[0] === 'sessao_iniciada')[1], { via: 'trial' }, 'sessao_iniciada com via=trial');
  eq([e.barra, e.urgente, e.readonly, e.aviso, e.modalFim], ['Teste grátis · faltam 15 dias', false, false, 'none', 'none'], 'dia 0: barra neutra "faltam 15 dias", nada bloqueado');
  await c.page.reload({ waitUntil: 'load' });
  await c.page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
  await c.page.waitForFunction(() => getComputedStyle(document.getElementById('telaInicial')).display === 'none');
  eq(contar(await evs(c.page), 'trial_iniciado'), 0, 'reabrir NÃO reemite trial_iniciado');
  eq((await estado(c.page)).trialInicio, '2026-09-10', 'reabrir mantém o trialInicio');
  await fechar(c);

  // ================= 2. fronteiras =================
  console.log('2. fronteiras do trial (hoje = 10/09/2026)');
  const casos = [
    ['D+0', 0, 'trial', 'Teste grátis · faltam 15 dias', false],
    ['D+1', 1, 'trial', 'Teste grátis · faltam 14 dias', false],
    ['D+9 (rest=6, ainda neutro)', 9, 'trial', 'Teste grátis · faltam 6 dias', false],
    ['D+10 (rest=5, vira urgente)', 10, 'trial', 'Seu teste termina em 5 dias. Continue com tudo por R$ 20/mês.', true],
    ['D+14 (rest=1, singular)', 14, 'trial', 'Seu teste termina em 1 dia. Continue com tudo por R$ 20/mês.', true],
    ['D+15 (rest=0, ÚLTIMO dia ainda trial)', 15, 'trial', 'Seu teste termina em 0 dias. Continue com tudo por R$ 20/mês.', true],
    ['D+16 (rest=-1, bloqueia)', 16, 'bloqueado', null, false],
    ['D+400', 400, 'bloqueado', null, false],
  ];
  for(const [nome, dias, st, barra, urg] of casos){
    c = await abrirT(browser, { assin: A(sem(dias)) });
    e = await estado(c.page);
    const bloq = st === 'bloqueado';
    eq([e.status, e.barra, e.urgente, e.readonly, e.trialBloqueado, e.aviso, e.modalFim],
      [st, barra, urg, bloq, bloq, bloq ? 'flex' : 'none', bloq ? 'flex' : 'none'], `${nome}: status/barra/classes/aviso/modal`);
    await fechar(c);
  }

  // ================= 3. virada à meia-noite (data LOCAL) =================
  console.log('3. virada do dia 15→16 em horário local');
  c = await abrirT(browser, { fixed: '2026-09-10T23:59:00-03:00', assin: A('2026-08-26') });
  eq((await estado(c.page)).status, 'trial', '23:59 BRT do D+15 (já 02:59Z do dia seguinte): ainda trial');
  await c.page.clock.setFixedTime(new Date('2026-09-11T00:00:00-03:00'));
  await c.page.evaluate(() => avaliarAssinatura());
  eq((await estado(c.page)).status, 'bloqueado', '00:00 BRT do D+16: avaliarAssinatura() bloqueia');
  await fechar(c);
  c = await abrirT(browser, { fixed: '2026-09-11T00:00:00-03:00', assin: A('2026-08-26') });
  eq((await estado(c.page)).status, 'bloqueado', 'abrir às 00:00 BRT do D+16: bloqueado');
  await fechar(c);

  // sessão aberta atravessa o prazo: nada reavalia
  c = await abrirT(browser, { fixed: '2026-09-10T12:00:00-03:00', assin: A('2026-08-26') });
  await c.page.clock.setFixedTime(new Date('2026-09-12T12:00:00-03:00'));
  await c.page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); });
  eq((await estado(c.page)).status, 'trial', '[BUG-CONHECIDO] sessão aberta que atravessa o fim do teste NÃO é reavaliada em visibilitychange/focus/pageshow (o comentário de avaliarAssinatura diz "ao voltar de background", mas só roda no boot, ao assinar e ao reverter; esperado: bloqueado)');
  await fechar(c);

  // ================= 4. bloqueado: modal, aviso, telemetria =================
  console.log('4. bloqueado — modal, aviso e telemetria');
  c = await abrirT(browser, { assin: A(sem(20)) });
  e = await estado(c.page);
  eq(contar(await evs(c.page), 'trial_expirado'), 1, 'trial_expirado emitido 1x ao bloquear');
  eq(await c.page.evaluate(() => localStorage.getItem('bc_tel_expirado2')), '1', 'flag bc_tel_expirado2 gravado');
  eq(contar(await evs(c.page), 'trial_iniciado'), 0, 'trial_iniciado NÃO emitido (trialInicio já existia)');
  eq((await evsFull(c.page)).find(x => x[0] === 'sessao_iniciada')[1], { via: 'bloqueado' }, 'sessao_iniciada com via=bloqueado');
  await c.page.evaluate(() => avaliarAssinatura());
  await c.page.evaluate(() => avaliarAssinatura());
  eq(contar(await evs(c.page), 'trial_expirado'), 1, 'reavaliar várias vezes na mesma sessão não reemite');
  eq(e.barra, null, 'barra do trial some quando bloqueado');
  ok(/Seu teste de 15 dias terminou/.test(await c.page.textContent('#modalTrialFim h2')), 'modal "Seu teste de 15 dias terminou" aberto');
  await c.page.evaluate(() => continuarSoConsultando());
  eq((await estado(c.page)).modalFim, 'none', '"Continuar só consultando" fecha o modal');
  await c.page.evaluate(() => avaliarAssinatura());
  eq((await estado(c.page)).modalFim, 'none', 'modal NÃO reabre na mesma sessão');
  eq(contar(await evs(c.page), 'continuar_consultando_clicado'), 1, 'continuar_consultando_clicado 1x');
  eq((await estado(c.page)).aviso, 'flex', 'faixa de aviso do bloqueio continua visível');
  await c.page.reload({ waitUntil: 'load' });
  await c.page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
  await c.page.waitForFunction(() => getComputedStyle(document.getElementById('telaInicial')).display === 'none');
  eq(contar(await evs(c.page), 'trial_expirado'), 0, 'nova sessão: trial_expirado NÃO reemitido (flag bc_tel_expirado2)');
  eq((await estado(c.page)).modalFim, 'flex', 'nova sessão: o modal reabre (a dispensa vale só para a sessão)');
  await fechar(c);
  // só o flag ANTIGO existe → reenvia 1x (a .22 renomeou o flag de propósito)
  c = await abrirT(browser, { assin: A(sem(20)), extraInit: `if(!localStorage.getItem('bc_t_flag')){ localStorage.setItem('bc_t_flag','1'); localStorage.setItem('bc_tel_expirado','1'); }` });
  eq([contar(await evs(c.page), 'trial_expirado'), await c.page.evaluate(() => localStorage.getItem('bc_tel_expirado2'))], [1, '1'], 'só o flag antigo bc_tel_expirado: reenvia 1x e grava bc_tel_expirado2');
  await fechar(c);

  // ?readonly=1 (link de compartilhamento) com trial vencido
  c = await abrirT(browser, { assin: A(sem(20)), query: '&readonly=1' });
  e = await estado(c.page);
  eq([e.status, e.readonly, e.aviso, e.modalFim], ['bloqueado', true, 'none', 'none'], '?readonly=1 + trial vencido: readonly vem do link; sem aviso e sem modal de trial');
  eq(await evs(c.page), [], '?readonly=1: nenhum evento de telemetria (nem trial_expirado)');
  eq(await c.page.evaluate(() => localStorage.getItem('bc_tel_expirado2')), null, '?readonly=1: flag bc_tel_expirado2 NÃO é gravado');
  await fechar(c);
  c = await abrirT(browser, { assin: A(sem(2)), query: '&readonly=1' });
  eq((await estado(c.page)).readonly, true, '?readonly=1 + trial válido: continua só leitura (modo do link)');
  await fechar(c);

  // ================= 5. o que bloqueia / o que continua =================
  console.log('5. soft-block — o que bloqueia e o que continua');
  c = await abrirT(browser, { assin: A(sem(20)) });
  const p = c.page;
  await p.evaluate(async () => {
    contas.push('Nubank');
    transacoes = [
      { id: 1, tipo: 'gasto', desc: 'Aluguel', valor: 1500, categoria: 'Moradia', conta: 'Nubank', data: '2026-09-15', status: 'pendente' },
      { id: 2, tipo: 'receita', desc: 'Salário', valor: 4000, categoria: 'Receita', conta: 'Nubank', data: '2026-09-05', status: 'pago' },
    ];
    await salvarTx(); render();
    document.getElementById('modalTrialFim').style.display = 'none'; // tira o modal da frente
  });
  const n0 = () => p.evaluate(() => transacoes.length);
  const planosAberto = () => p.evaluate(() => getComputedStyle(document.getElementById('modalPlanos')).display === 'flex');
  const fecharPlanosJa = () => p.evaluate(() => { document.getElementById('modalPlanos').style.display = 'none'; });

  eq(await p.evaluate(() => podeEditar()), false, 'podeEditar() = false');
  eq(await planosAberto(), true, 'podeEditar() bloqueado abre o modal de planos'); await fecharPlanosJa();

  await p.evaluate(() => { document.getElementById('descricao').value = 'Teste'; document.getElementById('valor').value = '10'; });
  await p.evaluate(() => adicionar());
  eq([await n0(), await planosAberto()], [2, true], 'LANÇAR (adicionar): nada criado + abre planos'); await fecharPlanosJa();
  await p.evaluate(() => abrirModalRapido());
  eq([await p.evaluate(() => getComputedStyle(document.getElementById('modalRapido')).display), await planosAberto()], ['none', true], 'LANÇAR (registro rápido): modal não abre + abre planos'); await fecharPlanosJa();
  await p.evaluate(() => { document.getElementById('rapValor').value = '5'; document.getElementById('rapDesc').value = 'cafe'; salvarRapido(); });
  eq([await n0(), await planosAberto()], [2, true], 'LANÇAR (salvarRapido): nada criado'); await fecharPlanosJa();
  await p.evaluate(() => abrirModalCategorias());
  eq(await p.evaluate(() => getComputedStyle(document.getElementById('modalCategorias')).display), 'none', 'CATEGORIAS: modal não abre'); await fecharPlanosJa();
  const imp = await p.evaluate(async () => { await iniciarImportacao('Nubank', new File(['<OFX><STMTTRN><DTPOSTED>20260905<TRNAMT>-1.00<NAME>x'], 'a.ofx')); return importacaoPendente; });
  eq([imp, await planosAberto()], [null, true], 'IMPORTAR extrato: não abre a pré-visualização + abre planos'); await fecharPlanosJa();

  // a barreira de EDITAR/EXCLUIR/MARCAR PAGO é só visual (.editable-only): a UI some
  await p.evaluate(() => mudarAbaPrincipal('lancamentos'));
  const ui = await p.evaluate(() => {
    const vis = el => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
    const eds = [...document.querySelectorAll('.editable-only')];
    return {
      totalEditable: eds.length, algumVisivel: eds.filter(vis).length,
      form: vis(document.getElementById('formTituloLancamento')), fab: vis(document.getElementById('fab')),
      acoesLinha: [...document.querySelectorAll('#corpoTabela .actions')].filter(vis).length,
      linhas: document.querySelectorAll('#corpoTabela tr').length,
      checks: [...document.querySelectorAll('#corpoTabela .col-check')].filter(vis).length,
      painelBackup: vis(document.getElementById('painelBackup')),
    };
  });
  ok(ui.totalEditable >= 10, `existem ≥10 elementos .editable-only (${ui.totalEditable})`);
  eq(ui.algumVisivel, 0, 'NENHUM .editable-only visível sob body.readonly');
  eq([ui.form, ui.fab, ui.acoesLinha, ui.checks, ui.painelBackup], [false, false, 0, 0, false], 'form "Novo lançamento", FAB, ✓/editar/excluir da linha, checkboxes e painel de backup somem');
  ok(ui.linhas >= 2, 'mas as linhas continuam listadas (consulta)');
  // funções SEM guard próprio: a barreira é só CSS (aceito na Fase 1: o trial é burlável por DevTools)
  await p.evaluate(() => marcarComoPago(1));
  eq(await p.evaluate(() => transacoes.find(t => t.id === 1).status), 'pago', 'marcarComoPago(): função SEM guard — só o botão some (caracterização)');
  await p.evaluate(() => remover(2));
  eq(await n0(), 1, 'remover(): função SEM guard — só o botão some (caracterização)');
  await p.evaluate(() => { document.getElementById('modalExcluirParcela').style.display = 'none'; });

  // continua funcionando
  console.log('5b. soft-block — o que continua funcionando');
  await p.evaluate(async () => { transacoes = [
    { id: 1, tipo: 'gasto', desc: 'Aluguel', valor: 1500, categoria: 'Moradia', conta: 'Nubank', data: '2026-09-15', status: 'pendente' },
    { id: 2, tipo: 'receita', desc: 'Salário', valor: 4000, categoria: 'Receita', conta: 'Nubank', data: '2026-09-05', status: 'pago' }]; await salvarTx(); render(); });
  for(const aba of ['geral', 'lancamentos', 'metas', 'orcamento', 'geral']){
    await p.evaluate(a => mudarAbaPrincipal(a), aba);
  }
  eq(await p.evaluate(() => document.body.dataset.aba), 'geral', 'navegar entre as abas');
  eq(await p.evaluate(() => { mudarSubAbaGeral('analise'); const a = subAbaGeral; mudarSubAbaGeral('resumo'); return [a, subAbaGeral]; }), ['analise', 'resumo'], 'sub-abas Resumo/Análise');
  eq(await p.evaluate(() => { transacoes.push({ id: 3, tipo: 'gasto', desc: 'Agosto', valor: 1, categoria: 'Outros', conta: 'Nubank', data: '2026-08-10', status: 'pago' }); popularSeletorMes(); const s = document.getElementById('mesSel'); s.value = '2026-08'; s.dispatchEvent(new Event('change')); const m = mesAtual; transacoes = transacoes.filter(t => t.id !== 3); popularSeletorMes(); s.value = '2026-09'; s.dispatchEvent(new Event('change')); return m; }), '2026-08', 'trocar o mês pelo seletor');
  ok(/R\$/.test(await p.textContent('#dsValor, .ds-valor').catch(() => 'R$')), 'valores renderizados (consulta)');
  await p.evaluate(() => { document.getElementById('busca') && (document.getElementById('busca').value = 'alug'); render(); });
  eq(await p.evaluate(() => document.querySelectorAll('#corpoTabela tr').length), 1, 'busca/filtro funciona');
  await p.evaluate(() => { document.getElementById('busca').value = ''; render(); });
  const csv = await p.evaluate(async () => {
    let cap; const o = URL.createObjectURL; URL.createObjectURL = b => { cap = b; return o.call(URL, b); };
    exportarCSV(); URL.createObjectURL = o; return cap ? await cap.text() : null;
  });
  ok(csv && /Aluguel/.test(csv) && /Salário/.test(csv), 'EXPORTAR CSV funciona');
  const pdfs = await p.evaluate(() => {
    const Orig = jspdf.jsPDF; window.__pdfs = [];
    jspdf.jsPDF = function(...a){ const d = new Orig(...a); d.save = n => window.__pdfs.push(n); return d; };
    jspdf.jsPDF.prototype = Orig.prototype;
    exportarPDF(); exportarPDFAnual(); exportarPDFIR(); jspdf.jsPDF = Orig;
    return window.__pdfs;
  });
  eq(pdfs.length, 3, 'EXPORTAR PDF mensal, anual e IR funcionam (3 saves)');
  const bk = await p.evaluate(async () => {
    let cap; const o = URL.createObjectURL; URL.createObjectURL = b => { cap = b; return o.call(URL, b); };
    document.querySelector('#modalTrialFim button[onclick*="exportarBackupJSON"]').click(); URL.createObjectURL = o;
    return JSON.parse(await cap.text());
  });
  ok(bk.transacoes.length === 2 && bk.assinatura && bk.assinatura.status === 'bloqueado', 'BACKUP pelo botão do modal de fim de teste: JSON com os lançamentos');
  const ajuda = await p.evaluate(() => { const h = [...document.querySelectorAll('.help-icon')].filter(x => x.getClientRects().length > 0); return { n: h.length, tip: h[0] && h[0].dataset.tip.length > 10, foco: h[0] && (h[0].focus(), document.activeElement === h[0]) }; });
  ok(ajuda.n > 0 && ajuda.tip && ajuda.foco, 'AJUDA (balões .help-icon) visíveis e focáveis');
  await p.evaluate(() => { toggleMenuConfig(); });
  const menu = await p.evaluate(() => { const vis = el => getClientRects.call(el).length > 0; const bts = [...document.querySelectorAll('#menuConfig button')].filter(b => b.getClientRects().length > 0).map(b => b.textContent.trim()); return bts; });
  ok(menu.some(t => /Minha assinatura/.test(t)) && menu.some(t => /Avisos de vencimento/.test(t)), 'menu ⚙️ mantém "Minha assinatura" e "Avisos de vencimento"');
  await p.evaluate(() => { toggleMenuConfig(); });
  // backup depois de dispensar o modal
  await p.evaluate(() => { document.getElementById('modalTrialFim').style.display = 'none'; toggleMenuConfig(); });
  // P2: com o trial vencido e o modal dispensado, EXPORTAR backup continua acessível pelo menu ⚙️ (sem .editable-only)
  const vis = (sel) => p.evaluate(s => [...document.querySelectorAll(s)].filter(b => b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden').map(b => b.id || b.textContent.trim()), sel);
  eq(await vis('#menuConfig [onclick*="exportarBackupJSON"]'), ['btnBackupMenu'], 'com o trial vencido e o modal dispensado, o menu ⚙️ mostra "Baixar backup (.json)" (um único botão de exportar)');
  eq(await p.evaluate(() => document.getElementById('btnBackupMenu').classList.contains('editable-only')), false, 'o item de exportar backup NÃO tem .editable-only');
  const bkMenu = await p.evaluate(async () => {
    let cap; const o = URL.createObjectURL; URL.createObjectURL = b => { cap = b; return o.call(URL, b); };
    document.getElementById('btnBackupMenu').click(); URL.createObjectURL = o;
    const j = JSON.parse(await cap.text());
    return { versao: j.versao, temTransacoes: Array.isArray(j.transacoes), menuFechou: getComputedStyle(document.getElementById('menuConfig')).display === 'none', status: j.assinatura && j.assinatura.status };
  });
  eq(bkMenu, { versao: 1, temTransacoes: true, menuFechou: true, status: 'bloqueado' }, 'clicar gera o arquivo (versao 1, com os lançamentos), fecha o menu e funciona com o app bloqueado');
  // IMPORTAR continua escondido em modo bloqueado/somente leitura
  eq([(await vis('#painelBackup')).length, (await vis('#arquivoBackup')).length, (await vis('[onclick*="toggleMenuBackup"]')).length, (await vis('#menuConfig [onclick*="importarBackup"], #menuConfig input[type=file]')).length], [0, 0, 0, 0], 'IMPORTAR segue escondido: painel de backup, campo de arquivo e os botões que o abrem não aparecem com o trial vencido');
  eq(await vis('[onclick*="exportarComprovantes"]'), [], 'e o painel de backup completo (comprovantes) também segue escondido');
  await p.evaluate(() => toggleMenuConfig());
  // backup importado: função sem guard
  const imp2 = await p.evaluate(async () => {
    const antes = transacoes.length; confirm = () => true; alert = () => {};
    await importarBackupJSON(new File([JSON.stringify({ transacoes: [], contas: ['Outros'] })], 'b.json'));
    return [antes, transacoes.length];
  });
  eq(imp2, [2, 0], 'importarBackupJSON(): função SEM guard — só o painel de backup some (caracterização)');
  eq(await estado(p).then(x => x.status), 'bloqueado', 'importar backup sem assinatura NÃO desbloqueia nem estica o teste');
  await fechar(c);

  // ================= 6. Assinar (provisório) =================
  console.log('6. "Assinar" provisório — [PROVISORIO-FASE2]');
  c = await abrirT(browser, { assin: A(sem(20)) });
  await c.page.evaluate(() => abrirPlanos());
  ok(await c.page.isVisible('#modalPlanos button[onclick="assinarProvisorio()"]'), '[PROVISORIO-FASE2] botão "Assinar agora" existe no modal de planos');
  ok(/apenas libera o acesso/.test(await c.page.textContent('#modalPlanos')), '[PROVISORIO-FASE2] modal avisa que assinar só libera o acesso');
  await c.page.click('#modalPlanos button[onclick="assinarProvisorio()"]');
  await c.page.waitForFunction(() => assinatura.status === 'ativo');
  e = await estado(c.page);
  eq([e.status, e.assinouEm, e.readonly, e.trialBloqueado, e.aviso, e.modalFim, e.planos, e.barra], ['ativo', '2026-09-10', false, false, 'none', 'none', 'none', null],
    '[PROVISORIO-FASE2] "Assinar agora" libera SEM cobrança: ativo, readonly off, avisos e modais fechados');
  ok(c.page.__dialogos.some(m => /sem cobrança/.test(m)), '[PROVISORIO-FASE2] alert informa "sem cobrança"');
  eq((await evsFull(c.page)).filter(x => x[0] === 'assinar_clicado'), [['assinar_clicado', { via: 'bloqueio' }]], 'assinar_clicado 1x com via=bloqueio');
  eq((await guardada(c.page)).assinouEm, '2026-09-10', '[PROVISORIO-FASE2] assinouEm persistido localmente (sem verificação de pagamento)');
  await c.page.evaluate(() => { document.getElementById('descricao').value = 'Pós-assinatura'; document.getElementById('valor').value = '10'; });
  await c.page.evaluate(() => adicionar());
  eq(await c.page.evaluate(() => transacoes.some(t => t.desc === 'Pós-assinatura')), true, 'depois de assinar, lançar volta a funcionar');
  await c.page.reload({ waitUntil: 'load' });
  await c.page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
  await c.page.waitForFunction(() => getComputedStyle(document.getElementById('telaInicial')).display === 'none');
  e = await estado(c.page);
  eq([e.status, e.readonly], ['ativo', false], 'reabrir: segue ativo');
  eq([contar(await evs(c.page), 'trial_expirado'), contar(await evs(c.page), 'assinar_clicado')], [0, 0], 'reabrir: não reemite trial_expirado nem assinar_clicado');
  await c.page.evaluate(() => abrirMinhaAssinatura());
  ok(/Ativa/.test(await c.page.textContent('#minhaAssinaturaCorpo')) && await c.page.isVisible('#minhaAssinaturaCorpo button[onclick="reverterAssinaturaTeste()"]'), '[PROVISORIO-FASE2] "Minha assinatura": Ativa + botão "Reverter (só para testes)"');
  await c.page.click('#minhaAssinaturaCorpo button[onclick="reverterAssinaturaTeste()"]');
  await c.page.waitForFunction(() => assinatura.status === 'bloqueado');
  e = await estado(c.page);
  eq([e.status, e.assinouEm, e.readonly], ['bloqueado', null, true], '[PROVISORIO-FASE2] reverter volta ao estado pela data (bloqueado)');
  await fechar(c);
  // assinar durante o trial
  c = await abrirT(browser, { assin: A(sem(3)) });
  await c.page.evaluate(() => abrirMinhaAssinatura());
  ok(/Em teste/.test(await c.page.textContent('#minhaAssinaturaCorpo')) && /faltam 12 dias/.test(await c.page.textContent('#minhaAssinaturaCorpo')) && /começou em 07\/09\/2026/.test(await c.page.textContent('#minhaAssinaturaCorpo')), '"Minha assinatura" em teste: "faltam 12 dias (começou em 07/09/2026)"');
  await c.page.click('#minhaAssinaturaCorpo button[onclick="assinarProvisorio()"]');
  await c.page.waitForFunction(() => assinatura.status === 'ativo');
  eq((await evsFull(c.page)).filter(x => x[0] === 'assinar_clicado'), [['assinar_clicado', { via: 'trial' }]], 'assinar durante o teste: assinar_clicado 1x com via=trial');
  eq(contar(await evs(c.page), 'trial_expirado'), 0, 'e nenhum trial_expirado');
  await fechar(c);
  // encerrado (texto)
  c = await abrirT(browser, { assin: A(sem(20)) });
  await c.page.evaluate(() => abrirMinhaAssinatura());
  ok(/Teste encerrado/.test(await c.page.textContent('#minhaAssinaturaCorpo')), '"Minha assinatura" bloqueado: "Teste encerrado"');
  await fechar(c);

  // ================= 7. relógio para trás e estado corrompido =================
  console.log('7. relógio para trás e trialInicio ausente/corrompido');
  c = await abrirT(browser, { fixed: FIX, assin: A('2026-08-25') });
  eq((await estado(c.page)).status, 'bloqueado', 'pré-condição: D+16 bloqueado');
  await c.page.clock.setFixedTime(new Date('2026-08-28T12:00:00-03:00')); // usuário volta a data do aparelho
  await c.page.reload({ waitUntil: 'load' });
  await c.page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
  await c.page.waitForFunction(() => getComputedStyle(document.getElementById('telaInicial')).display === 'none');
  e = await estado(c.page);
  eq([e.status, e.readonly, e.barra], ['trial', false, 'Teste grátis · faltam 12 dias'], '[PROVISORIO-FASE2] relógio voltado para 28/08: DESBLOQUEIA (faltam 12 dias) — o trial vive só no aparelho; fecha com o backend da Fase 2');
  await fechar(c);
  c = await abrirT(browser, { fixed: '2026-09-01T12:00:00-03:00', assin: A('2026-09-10') });
  e = await estado(c.page);
  eq([e.status, e.barra], ['trial', 'Teste grátis · faltam 24 dias'], '[PROVISORIO-FASE2] trialInicio no futuro (relógio antes do início): "faltam 24 dias" — o teste estica');
  await fechar(c);

  for(const [nome, seed] of [['objeto vazio {}', {}], ['sem trialInicio', { status: 'trial', assinouEm: null }], ['trialInicio vazio ""', { status: 'trial', trialInicio: '', assinouEm: null }],
    ['trialInicio null', A(null)], ['valor não-objeto ("lixo")', 'lixo'], ['JSON inválido', { raw: '{oops' }], ['null', null], ['array', [1, 2]]]){
    c = await abrirT(browser, { assin: seed === null ? { raw: 'null' } : (typeof seed === 'string' ? { raw: JSON.stringify(seed) } : seed) });
    e = await estado(c.page);
    eq([e.status, e.trialInicio, contar(await evs(c.page), 'trial_iniciado')], ['trial', '2026-09-10', 1], `assinatura guardada ${nome}: recomeça o teste hoje + trial_iniciado 1x`);
    await fechar(c);
  }
  c = await abrirT(browser, { assin: { status: 'ativo', trialInicio: null, assinouEm: '2026-08-01' } });
  e = await estado(c.page);
  eq([e.status, e.trialInicio, contar(await evs(c.page), 'trial_iniciado')], ['ativo', null, 0], 'assinouEm sem trialInicio: ativo, NÃO inicia teste, sem trial_iniciado');
  await fechar(c);
  for(const [nome, bruto] of [['"abc"', 'abc'], ['data impossível "2026-13-45"', '2026-13-45'], ['número 20260910', 20260910]]){
    c = await abrirT(browser, { assin: { status: 'trial', trialInicio: bruto, assinouEm: null } });
    e = await estado(c.page);
    eq([e.status, e.readonly, e.barra], ['trial', false, 'Teste grátis · faltam NaN dias'], `[BUG-CONHECIDO] trialInicio corrompido ${nome}: NUNCA bloqueia e a barra mostra "faltam NaN dias" (esperado: recomeçar o teste ou bloquear)`);
    await fechar(c);
  }

  // ================= 8. sync entre aparelhos (aplicarDadosImportados) =================
  console.log('8. sync — aplicarDadosImportados');
  const sync = async (page, blob) => page.evaluate(async b => { await aplicarDadosImportados(b); return { ...assinatura }; }, blob);
  c = await abrirT(browser, { assin: A('2026-09-05') });
  eq((await sync(c.page, { assinatura: { status: 'trial', trialInicio: '2026-09-01', assinouEm: null } })).trialInicio, '2026-09-01', 'remoto com trialInicio mais ANTIGO vence');
  eq((await guardada(c.page)).trialInicio, '2026-09-01', '… e é persistido');
  await fechar(c);
  c = await abrirT(browser, { assin: A('2026-09-05') });
  eq((await sync(c.page, { assinatura: { status: 'trial', trialInicio: '2026-09-09', assinouEm: null } })).trialInicio, '2026-09-05', 'remoto mais NOVO não estica o teste');
  eq((await sync(c.page, { transacoes: [], contas: ['Outros'] })).trialInicio, '2026-09-05', 'remoto SEM assinatura preserva a local');
  eq(await c.page.evaluate(async () => { try{ await aplicarDadosImportados({ assinatura: 'lixo' }); return 'aceitou'; }catch(e){ return [e.codigo, assinatura.trialInicio]; } }), ['backup-invalido', '2026-09-05'], 'remoto com assinatura não-objeto: o blob inteiro é REJEITADO (backup-invalido) e a assinatura local não muda');
  eq((await sync(c.page, { assinatura: { status: 'trial', trialInicio: '', assinouEm: null } })).trialInicio, '2026-09-05', 'remoto com trialInicio vazio preserva a local');
  const comAss = await sync(c.page, { assinatura: { status: 'ativo', trialInicio: '2026-09-09', assinouEm: '2026-09-08' } });
  eq([comAss.status, comAss.assinouEm, comAss.trialInicio], ['ativo', '2026-09-08', '2026-09-05'], 'remoto com assinouEm → ativo, mantém o trialInicio mais antigo');
  eq((await sync(c.page, { assinatura: { status: 'ativo', trialInicio: '2026-09-09', assinouEm: '2026-09-01' } })).assinouEm, '2026-09-01', 'assinouEm mais ANTIGO vence');
  eq((await sync(c.page, { assinatura: { status: 'trial', trialInicio: '2026-09-09', assinouEm: null } })).assinouEm, '2026-09-01', 'remoto sem assinouEm NÃO desassina o local');
  await fechar(c);
  // aparelho novo (teste recém-iniciado) recebe do Drive um trialInicio antigo e vencido
  c = await abrirT(browser, {});
  eq((await estado(c.page)).status, 'trial', 'aparelho novo: começa em trial');
  const novo = await sync(c.page, { assinatura: { status: 'bloqueado', trialInicio: '2026-08-01', assinouEm: null } });
  eq(novo.trialInicio, '2026-08-01', 'aparelho novo recebe o trialInicio antigo do Drive (reinstalar não reinicia o teste)');
  e = await estado(c.page);
  eq([e.status, e.readonly], ['trial', false], '[BUG-CONHECIDO] depois do sync, o status/UI só atualizam no próximo boot: avaliarAssinatura() não roda em aplicarDadosImportados (o aparelho segue desbloqueado até recarregar; esperado: bloqueado)');
  await c.page.evaluate(() => avaliarAssinatura());
  eq((await estado(c.page)).status, 'bloqueado', '… e avaliarAssinatura() manual bloqueia');
  await fechar(c);
  // remoto com assinouEm num aparelho bloqueado
  c = await abrirT(browser, { assin: A(sem(20)) });
  await sync(c.page, { assinatura: { status: 'ativo', trialInicio: sem(20), assinouEm: '2026-09-09' } });
  e = await estado(c.page);
  eq([e.status, e.readonly], ['ativo', true], '[BUG-CONHECIDO] aparelho bloqueado que recebe assinouEm do Drive fica status "ativo" mas COM body.readonly até recarregar (esperado: liberar na hora)');
  await fechar(c);

  // ================= saúde =================
  console.log('9. saúde');
  c = await abrirT(browser, { assin: A(sem(20)) });
  await c.page.evaluate(() => { for(const a of ['geral', 'lancamentos', 'metas', 'orcamento']) mudarAbaPrincipal(a); });
  eq(c.page.__erros, [], 'nenhum erro de página com o app bloqueado percorrendo as 4 abas');
  await fechar(c);

  await browser.close();
  const t = res(); console.log(`\n${t.pass} ok, ${t.fail} fail`); process.exit(t.fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
