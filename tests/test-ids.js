// Ids únicos (pacote M da leva 3). uid() era Date.now() + sorteio de 0..999 a CADA chamada, e importação/parcelas/transferência
// somavam +i/+1 a ele: dois itens do mesmo lote podiam cair no mesmo id (editar/excluir um afetava o outro). Agora uid() é monotônico.
// Aqui a colisão é FORÇADA: relógio congelado e Math.random constante — com o uid() antigo todo id seria igual.
const fs = require('fs');
const path = require('path');
const { chromium, ok, abrir, res } = require('./lib');
const eq = (a, b, n) => { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, A === B ? n : `${n}  [obtido ${A} | esperado ${B}]`); };
const FIX = '2026-09-10T12:00:00-03:00';
const unicos = (arr) => new Set(arr).size;

(async () => {
  // ---- guarda de código-fonte: nenhum id é montado somando a um uid() ----
  const fonte = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  eq([...fonte.matchAll(/uid\(\)\s*\+/g)].length, 0, 'guarda: nenhum "uid() + n" no código (cada id vem de UMA chamada de uid(); somar a ela reabre a colisão com a próxima chamada)');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const { page } = await abrir(browser, { fixed: FIX });
  page.on('dialog', d => d.accept());
  await page.evaluate(() => { Math.random = () => 0.5; });   // colisão forçada: sem o contador, TODO uid() devolveria o mesmo número

  // ---- uid() ----
  console.log('1. uid()');
  const u = await page.evaluate(() => { const a = []; for(let i = 0; i < 500; i++) a.push(uid()); return { a, agora: Date.now() }; });
  eq(unicos(u.a), 500, '500 chamadas seguidas de uid() com relógio e Math.random fixos: 500 ids distintos');
  ok(u.a.every((x, i) => i === 0 || x > u.a[i - 1]), 'estritamente crescentes (monotônico)');
  ok(u.a.every(x => typeof x === 'number' && Number.isInteger(x)), 'continuam NÚMEROS inteiros (mesmo tipo dos ids já gravados)');
  ok(u.a[0] >= u.agora && u.a[0] < u.agora + 2000, `mesma ordem de grandeza de antes (Date.now() + até ~1000): ${u.a[0] - u.agora} acima do relógio`);

  // ---- extrato (OFX/CSV): confirmarImportacao ----
  console.log('2. importação de extrato com 500 lançamentos');
  const ext = await page.evaluate(async () => {
    transacoes = [{ id: 1, tipo: 'gasto', desc: 'antigo', valor: 1, categoria: 'Outros', conta: 'Nubank', data: '2026-09-01', status: 'pago' }];
    mesAtual = '2026-09';
    importacaoPendente = { conta: 'Nubank', formato: 'ofx', jaImportados: 0, itens: Array.from({ length: 500 }, (_, i) => ({ nova: { data: '2026-09-05', desc: 'Compra ' + i, valor: -(i + 1), fitid: 'F' + i }, status: 'nova', marcado: true, categoria: 'Outros' })) };
    confirmarImportacao();
    return { n: transacoes.length, ids: transacoes.map(t => t.id) };
  });
  eq([ext.n, unicos(ext.ids)], [501, 501], '500 lançamentos importados + 1 antigo: 501 ids distintos');
  // sorteio ADVERSARIAL: cada chamada sorteia 1 a menos que a anterior, então uid()+i dava o MESMO id para todos os itens
  const adv = await page.evaluate(async () => {
    let k = 0; const orig = Math.random; Math.random = () => (999 - (k++ % 1000)) / 1000;
    transacoes = []; mesAtual = '2026-09';
    importacaoPendente = { conta: 'Nubank', formato: 'ofx', jaImportados: 0, itens: Array.from({ length: 500 }, (_, i) => ({ nova: { data: '2026-09-05', desc: 'Compra ' + i, valor: -(i + 1), fitid: 'G' + i }, status: 'nova', marcado: true, categoria: 'Outros' })) };
    confirmarImportacao();
    Math.random = orig;
    return transacoes.map(t => t.id);
  });
  eq(unicos(adv), 500, 'extrato de 500 lançamentos com Math.random ADVERSARIAL (decrescente): 500 ids distintos (antes: 1)');
  ok(ext.ids.every(x => typeof x === 'number'), 'todos os ids do extrato são número');

  // ---- parcelas ----
  console.log('3. compra parcelada');
  const par = await page.evaluate(async () => {
    transacoes = []; editandoId = null;
    document.getElementById('tipo').value = 'gasto';
    document.getElementById('descricao').value = 'Geladeira';
    document.getElementById('valor').value = '10';
    document.getElementById('parcelas').value = '48';
    for(let k = 0; k < 11; k++){ await adicionar(); document.getElementById('descricao').value = 'Geladeira ' + k; document.getElementById('valor').value = '10'; document.getElementById('parcelas').value = '48'; }
    return { n: transacoes.length, ids: transacoes.map(t => t.id), grupos: [...new Set(transacoes.map(t => t.grupoParcela))].length };
  });
  eq([par.n, unicos(par.ids), par.grupos], [528, 528, 11], '11 compras de 48 parcelas = 528 lançamentos: 528 ids distintos e 11 grupos distintos');

  // ---- transferências ----
  console.log('4. transferências');
  const tr = await page.evaluate(async () => {
    transacoes = []; contas = ['Nubank', 'Itaú', 'Outros']; popularSelectsEstaticos();
    for(let k = 0; k < 100; k++){
      document.getElementById('tipo').value = 'transferencia'; toggleCategoriaSel();
      document.getElementById('conta').value = 'Nubank'; document.getElementById('contaDestino').value = 'Itaú';
      document.getElementById('valor').value = '5'; document.getElementById('descricao').value = 'T' + k;
      await adicionar();
    }
    return { n: transacoes.length, ids: transacoes.map(t => t.id), grupos: unicos0(transacoes.map(t => t.grupoTransferencia)) };
    function unicos0(a){ return new Set(a).size; }
  });
  eq([tr.n, unicos(tr.ids), tr.grupos], [200, 200, 100], '100 transferências = 200 pernas: 200 ids distintos e 100 grupos distintos (a "entrada" não é mais uid()+1 da "saída")');

  // ---- duplicar, conta fixa, meta ----
  console.log('5. duplicar / contas fixas / metas');
  const outros = await page.evaluate(async () => {
    transacoes = [{ id: 7, tipo: 'gasto', desc: 'Base', valor: 3, categoria: 'Outros', conta: 'Nubank', data: '2026-09-01', status: 'pago' }];
    for(let k = 0; k < 100; k++) duplicarLancamento(7);
    recorrentes = []; metas = [];
    for(let k = 0; k < 100; k++){
      document.getElementById('recDesc').value = 'R' + k; document.getElementById('recValor').value = '9'; criarRecorrente();
      document.getElementById('metaNome').value = 'M' + k; document.getElementById('metaValor').value = '100'; document.getElementById('metaPrazo').value = '2027-12-31'; criarMeta();
    }
    return { tx: [transacoes.length, new Set(transacoes.map(t => t.id)).size], rec: [recorrentes.length, new Set(recorrentes.map(r => r.id)).size], metas: [metas.length, new Set(metas.map(m => m.id)).size] };
  });
  eq(outros.tx, [101, 101], '100 duplicações: ids distintos');
  eq(outros.rec, [100, 100], '100 contas fixas: ids distintos');
  eq(outros.metas, [100, 100], '100 metas: ids distintos');

  await browser.close();
  const r = res();
  console.log(`\n${r.pass} ok, ${r.fail} fail`);
  process.exit(r.fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
