// Regressão mínima dos commits 22dc571 (hojeISO local) e 5474820 (avisos de vencimento).
// NÃO substitui a suíte original (perdida) — cobre só o que esses commits tocaram.
const { chromium, ok, abrir, res } = require('./lib');
const T = (id, data, extra = {}) => ({ id, tipo: 'gasto', desc: 'Conta ' + id, valor: 100, categoria: 'Outros', conta: 'Carteira', data, status: 'pendente', ...extra });
const set = (page, arr) => page.evaluate(async a => { transacoes = a; await salvarTx(); render(); }, arr);
const bannerTxt = page => page.evaluate(() => { const e = document.getElementById('barraVencimentos'); return e.style.display === 'none' ? null : e.querySelector('.bv-txt').textContent; });
const TARDE = '2026-09-10T23:30:00-03:00';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  console.log('A. consumidores de hojeISO às 23:30 BRT');
  let { ctx, page } = await abrir(browser, { fixed: TARDE });
  await set(page, [
    T(1, '2026-09-10'),                               // vence hoje
    T(2, '2026-09-11'),                               // amanhã
    { id: 3, tipo: 'receita', desc: 'Salário', valor: 3000, categoria: 'Receita', conta: 'Carteira', data: '2026-09-05', status: 'pago' },
  ]);
  ok(await page.evaluate(() => hojeISO()) === '2026-09-10', 'hojeISO = dia local');
  ok(await page.evaluate(() => mesAtual) === '2026-09', 'mesAtual = 2026-09');
  ok(await page.evaluate(() => statusEfetivo(transacoes.find(t => t.id === 1))) === 'pendente', 'statusEfetivo: conta de hoje segue pendente');
  ok(await page.evaluate(() => statusEfetivo(transacoes.find(t => t.id === 2))) === 'pendente', 'statusEfetivo: amanhã pendente');
  ok(await page.evaluate(() => diasEntre(hojeISO(), '2026-09-11')) === 1, 'diasEntre(hoje, amanhã) = 1');
  ok(await page.evaluate(() => diasEntre(hojeISO(), '2026-09-10')) === 0, 'diasEntre(hoje, hoje) = 0');
  ok(await page.evaluate(() => { const p = proximoPagamento(); return p && p.dias === 0 && p.data === '2026-09-10'; }), 'proximoPagamento = hoje (dias 0)');
  ok(await page.evaluate(() => document.getElementById('livreCard').style.display) === 'flex', 'renderLivreParaGastar: card do mês corrente visível');
  ok(/hoje/i.test(await page.evaluate(() => document.getElementById('livreProximo').textContent)), 'livreProximo fala de "hoje"');
  ok(await page.evaluate(() => document.getElementById('dobraSaldo').style.display) !== 'none', 'renderDobraSaldo: faixa visível no mês corrente');
  ok(await bannerTxt(page) === '⚠ 1 vence hoje · 1 nos próximos 3 dias', 'banner às 23:30: 1 hoje + 1 próximo (nenhuma atrasada)');
  ok(page.__erros.length === 0, 'sem erro de console/página ' + JSON.stringify(page.__erros));
  await ctx.close();

  console.log('B. virada de mês às 23:30 do dia 30');
  ({ ctx, page } = await abrir(browser, { fixed: '2026-09-30T23:30:00-03:00' }));
  await set(page, [T(1, '2026-09-30')]);
  ok(await page.evaluate(() => mesAtual) === '2026-09', 'mesAtual continua 2026-09');
  ok(await page.evaluate(() => statusEfetivo(transacoes[0])) === 'pendente', 'conta de 30/09 segue pendente');
  await ctx.close();

  console.log('C. ida e volta de estado (blob novo e antigo)');
  ({ ctx, page } = await abrir(browser, { fixed: TARDE }));
  await set(page, [T(1, '2026-09-10')]);
  await page.evaluate(() => { avisosVencimento = { hoje: false, proximos: true, atrasadas: false }; });
  const novo = await page.evaluate(() => JSON.parse(JSON.stringify(montarEstado())));
  ok(!!novo.avisosVencimento && novo.avisosVencimento.hoje === false, 'montarEstado traz avisosVencimento');
  await page.evaluate(async e => { avisosVencimento = { hoje: true, proximos: true, atrasadas: true }; transacoes = []; await aplicarDadosImportados(e); }, novo);
  ok(await page.evaluate(() => JSON.stringify(avisosVencimento)) === '{"hoje":false,"proximos":true,"atrasadas":false}', 'blob novo: preferências restauradas');
  ok(await page.evaluate(() => transacoes.length) === 1, 'blob novo: transações restauradas');
  const antigo = { ...novo }; delete antigo.avisosVencimento;
  await page.evaluate(async e => { await aplicarDadosImportados(e); }, antigo);
  ok(await page.evaluate(() => JSON.stringify(avisosVencimento)) === '{"hoje":true,"proximos":true,"atrasadas":true}', 'blob antigo (sem o campo): 3 true');
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('bc_avisosVencimento')).hoje) === true, 'blob antigo: persistido no storage');
  ok(page.__erros.length === 0, 'sem erro de console/página ' + JSON.stringify(page.__erros));
  await ctx.close();

  console.log('D. carga sem erro nas 4 abas (com e sem lançamentos)');
  for(const [rot, dados] of [['vazio', []], ['com lançamentos', [T(1, '2026-09-10'), T(2, '2026-09-12'), T(3, '2026-08-01'), { id: 4, tipo: 'receita', desc: 'Sal', valor: 3000, categoria: 'Receita', conta: 'Carteira', data: '2026-09-05', status: 'pago' }]]]){
    ({ ctx, page } = await abrir(browser, { fixed: TARDE }));
    await set(page, dados);
    for(const aba of ['geral', 'lancamentos', 'orcamento', 'metas']){
      await page.evaluate(a => mudarAbaPrincipal(a), aba);
      if(aba === 'geral') for(const sub of ['analise', 'resumo']){ await page.evaluate(s => mudarSubAbaGeral(s), sub); await page.waitForTimeout(150); }
      await page.waitForTimeout(150);
    }
    ok(page.__erros.length === 0, `${rot}: 4 abas sem erro ` + JSON.stringify(page.__erros));
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${rot}: sem scroll horizontal`);
    await ctx.close();
  }

  console.log('E. marcar como pago / desfazer atualiza o banner');
  ({ ctx, page } = await abrir(browser, { fixed: TARDE }));
  await set(page, [T(1, '2026-09-10'), T(2, '2026-09-11')]);
  ok(await bannerTxt(page) === '⚠ 1 vence hoje · 1 nos próximos 3 dias', 'antes');
  await page.evaluate(() => marcarComoPago(1));
  ok(await bannerTxt(page) === '1 nos próximos 3 dias', 'marcar pago: segmento "hoje" some, banner fica neutro');
  await page.evaluate(() => marcarComoPago(2));
  ok(await bannerTxt(page) === null, 'tudo pago: banner oculto');
  await page.evaluate(() => desfazer());
  ok(await bannerTxt(page) === '1 nos próximos 3 dias', 'desfazer: conta volta ao banner');
  await set(page, [T(1, '2026-09-10'), T(2, '2026-09-11')]);
  await page.evaluate(() => { marcarComoPago(1); desfazer(); });
  ok(await bannerTxt(page) === '⚠ 1 vence hoje · 1 nos próximos 3 dias', 'marcar + desfazer a conta de hoje: volta ao banner urgente');
  ok(page.__erros.length === 0, 'sem erro de console/página ' + JSON.stringify(page.__erros));
  await ctx.close();

  console.log('F. erro no banner não derruba o render');
  ({ ctx, page } = await abrir(browser, { fixed: TARDE }));
  await set(page, [T(1, '2026-09-10')]);
  const r = await page.evaluate(() => { window.renderBarraVencimentos = () => { throw new Error('boom'); }; document.getElementById('livreCard').style.display = 'none'; render(); return document.getElementById('livreCard').style.display; });
  ok(r === 'flex', 'renderLivreParaGastar ainda roda depois do erro no banner');
  await ctx.close();

  await browser.close();
  console.log(JSON.stringify(res()));
  process.exit(res().fail ? 1 : 0);
})();
