// Campo "+ add" das metas (addValorMeta): o valor digitado passa por parseValorBR, como os outros campos de dinheiro.
// Antes usava parseFloat: "50,5" virava 50 (perda de valor em silêncio) e "1.234,56" virava 1.
const { chromium, ok, abrir } = require('./lib');
const eq = (a, b, n) => { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, A === B ? n : `${n}  [obtido ${A} | esperado ${B}]`); };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const { page } = await abrir(browser, { fixed: '2026-09-10T12:00:00-03:00' });
  // digita `txt` no prompt do "+ add" e devolve o que o app gravou
  const aportar = (txt) => page.evaluate(async (txt) => {
    metas = [{ id: 1, nome: 'Viagem', valorAlvo: 5000, valorAtual: 0, prazo: '2027-06-30' }];
    transacoes = [];
    window.prompt = () => txt;
    addValorMeta(1);
    return { meta: metas[0].valorAtual, gastos: transacoes.filter(t => t.metaId === 1).map(t => t.valor), txt: document.querySelector('#toast') ? document.querySelector('#toast').textContent : '' };
  }, txt);

  for(const [digitado, esperado] of [['50,5', 50.5], ['1.234,56', 1234.56], ['50.5', 50.5], ['100', 100], ['R$ 75,90', 75.9], ['0,99', 0.99]]){
    const r = await aportar(digitado);
    eq([r.meta, r.gastos], [esperado, [esperado]], `"${digitado}" → meta e gasto de ${esperado} (nada de perda silenciosa)`);
  }
  for(const ruim of ['abc', '', '   ', '0', '-10', '12abc', '1e400', 'Infinity', null]){
    const r = await aportar(ruim);
    eq([r.meta, r.gastos], [0, []], `${JSON.stringify(ruim)} é recusado: a meta e os lançamentos não mudam`);
  }
  const lim = await page.evaluate(() => { metas = [{ id: 1, nome: 'V', valorAlvo: 100, valorAtual: 90, prazo: '' }]; transacoes = []; window.prompt = () => '50,5'; addValorMeta(1); return metas[0].valorAtual; });
  eq(lim, 100, 'o acumulado continua limitado ao valor alvo (90 + 50,5 → 100)');
  eq(page.__erros, [], 'sem erro de console/página');
  await browser.close();
  const { res } = require('./lib'); const r = res();
  console.log(`\n${r.pass} ok, ${r.fail} fail`);
  process.exit(r.fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
