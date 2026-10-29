// Saldos, "Você tem hoje", "Fim do mês", faturas de cartão e ponto flutuante — contra um conjunto
// de lançamentos conhecido, com as contas feitas À MÃO neste arquivo (comentadas). Caracteriza o
// comportamento ATUAL; o que parece errado leva [BUG-CONHECIDO] no nome do check.
// Relógio fixo 10/09/2026 12:00 BRT (mesAtual = 2026-09), PostHog bloqueado, sem waitForTimeout.
const { chromium, ok, abrir, res } = require('./lib');
const FIX = '2026-09-10T12:00:00-03:00';
const eq = (a, b, n) => { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, A === B ? n : `${n}  [obtido ${A} | esperado ${B}]`); };
const cent = (x) => Math.round(x * 100);
const eqC = (a, b, n) => eq(cent(a), cent(b), n + ` (R$ ${b.toFixed(2)})`); // compara em centavos

const T = (id, o) => ({ tipo: 'gasto', desc: 'T' + id, valor: 1, categoria: 'Outros', conta: 'Nubank', data: '2026-09-05', status: 'pago', ...o, id });
const TRF = (id, grupo, subtipo, conta, valor, data) => ({ id, tipo: 'transferencia', subtipo, desc: 'Transf', valor, categoria: 'Transferência', conta, data, status: 'pago', grupoTransferencia: grupo });
const poe = (page, { tx = [], contas, saldos = {}, rec = [], mes = '2026-09', filtro = '' } = {}) => page.evaluate(async ([tx, contasNovas, saldos, rec, mes, filtro]) => {
  transacoes = tx; saldosIniciais = saldos; recorrentes = rec;
  if(contasNovas) contas = contasNovas;
  snapshotAnterior = null;
  await salvarTx(); await salvarContas(); await salvarRec();
  popularSelectsEstaticos();
  document.getElementById('contaFiltro').value = filtro;
  mesAtual = mes; popularSeletorMes(); document.getElementById('mesSel').value = mes; render();
}, [tx, contas || null, saldos, rec, mes, filtro]);
const lerId = (page, id) => txt(page, '#' + id);
const num = (page, id) => page.evaluate(i => parseFloat(document.getElementById(i).dataset.valor), id);
const txt = (page, sel) => page.evaluate(s => document.querySelector(s).textContent.replace(/\s+/g, ' ').trim(), sel);
const linhas = (page) => page.evaluate(() => [...document.querySelectorAll('#livreBreakdown .lb-row')].map(r => [r.className.includes('sub') ? '  ' + r.firstElementChild.textContent.trim() : r.firstElementChild.textContent.trim(), r.lastElementChild.textContent.replace(/\s+/g, ' ').trim()]));
const saldo = (page, nome) => page.evaluate(n => saldoAtualConta(n), nome);
const R = (v) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // formato exibido pelo app (NBSP)
const setRelogio = async (page, iso) => { await page.clock.setFixedTime(new Date(iso)); };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const { page } = await abrir(browser, { fixed: FIX });
  page.on('dialog', d => d.accept());
  // prefers-reduced-motion: fmtValorAnimado escreve o valor final direto (sem tween) → texto determinístico, sem esperas
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'load' });
  await page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => getComputedStyle(document.getElementById('telaInicial')).display === 'none');

  // ================= 1. efeitoNoSaldo =================
  console.log('1. efeitoNoSaldo');
  const ef = (t) => page.evaluate(x => efeitoNoSaldo(x), t);
  eq([await ef({ tipo: 'receita', valor: 10 }), await ef({ tipo: 'gasto', valor: 10 }), await ef({ tipo: 'transferencia', subtipo: 'entrada', valor: 10 }), await ef({ tipo: 'transferencia', subtipo: 'saida', valor: 10 }), await ef({ tipo: 'outro', valor: 10 })],
    [10, -10, 10, -10, 0], 'receita +, gasto −, transferência entrada +, saída −, tipo desconhecido 0');

  // ================= 2. saldo por conta =================
  console.log('2. saldoAtualConta (cenário conhecido)');
  // Nubank: saldo inicial 1000 em 01/09.  Itaú: saldo inicial −200 em 15/08.   hoje = 10/09
  const CEN = [
    T(1, { conta: 'Nubank', tipo: 'receita', categoria: 'Receita', valor: 3000, data: '2026-09-02' }),          // conta  +3000
    T(2, { conta: 'Nubank', valor: 400, data: '2026-09-03' }),                                                    // conta  −400
    T(3, { conta: 'Nubank', valor: 50, data: '2026-08-31' }),                                                     // ANTES do saldo inicial → ignora
    T(4, { conta: 'Nubank', valor: 300, data: '2026-09-20', status: 'pendente' }),                                // pendente → ignora
    T(5, { conta: 'Nubank', valor: 120, data: '2026-09-05', status: 'pendente' }),                                // vencida → ignora
    T(6, { conta: 'Nubank', valor: 10, data: '2026-09-25' }),                                                     // pago mas DATADO no futuro → ignora
    TRF(7, 'g1', 'saida', 'Nubank', 500, '2026-09-04'), TRF(8, 'g1', 'entrada', 'Itaú', 500, '2026-09-04'),       // Nubank −500 / Itaú +500
    T(9, { conta: 'Itaú', valor: 70.9, data: '2026-09-06' }),                                                     // Itaú −70,90
    T(10, { conta: 'Itaú', tipo: 'receita', categoria: 'Receita', valor: 100.1, data: '2026-08-20' }),            // Itaú +100,10 (depois de 15/08)
    T(11, { conta: 'Itaú', tipo: 'receita', categoria: 'Receita', valor: 999, data: '2026-08-10' }),              // ANTES de 15/08 → ignora
  ];
  const SALDOS = { Nubank: { valor: 1000, em: '2026-09-01' }, 'Itaú': { valor: -200, em: '2026-08-15' } };
  await poe(page, { tx: CEN, contas: ['Nubank', 'Itaú', 'Outros'], saldos: SALDOS });
  // Nubank = 1000 + 3000 − 400 − 500 = 3100
  eqC(await saldo(page, 'Nubank'), 3100, 'Nubank = 1000 + 3000 − 400 − 500 (transferência de saída conta; pendente, vencida, anterior e futura não)');
  // Itaú = −200 + 100,10 + 500 − 70,90 = 329,20
  eqC(await saldo(page, 'Itaú'), 329.2, 'Itaú = −200 + 100,10 + 500 − 70,90 (saldo inicial NEGATIVO; transferência de entrada conta; lançamento anterior à data do saldo não)');
  eqC(await page.evaluate(() => saldoContaEm('Nubank', hojeISO())), 3100, 'saldoContaEm(Nubank, hoje) == saldoAtualConta');
  eqC(await page.evaluate(() => saldoContaEm('Itaú', hojeISO())), 329.2, 'saldoContaEm(Itaú, hoje) == saldoAtualConta');
  // o pago datado de 25/09 passa a contar quando o dia chega
  await setRelogio(page, '2026-09-25T12:00:00-03:00');
  eqC(await saldo(page, 'Nubank'), 3090, 'no dia 25/09 o gasto pago de R$ 10 datado nessa data passa a contar (3100 − 10)');
  await setRelogio(page, FIX);
  // saldo inicial com data futura
  await poe(page, {
    tx: [T(1, { conta: 'Carteira', valor: 10, data: '2026-09-05' }), T(2, { conta: 'Carteira', valor: 5, data: '2026-09-22' }), T(3, { conta: 'Carteira', tipo: 'receita', categoria: 'Receita', valor: 7, data: '2026-09-20' })],
    contas: ['Carteira', 'Outros'], saldos: { Carteira: { valor: 50, em: '2026-09-20' } },
  });
  eqC(await saldo(page, 'Carteira'), 50, 'saldo inicial datado NO FUTURO (20/09): nada anterior a ele conta e o que vem depois ainda não aconteceu → 50');
  eq(await page.evaluate(() => saldoContaEm('Carteira', '2026-09-10')), null, 'saldoContaEm numa data ANTERIOR à âncora → null');
  eqC(await page.evaluate(() => saldoContaEm('Carteira', '2026-09-30')), 52, 'saldoContaEm em 30/09 = 50 + 7 − 5');
  eqC(await page.evaluate(() => saldoContaEm('Carteira', '2026-09-20')), 57, 'saldoContaEm exatamente na data âncora inclui os lançamentos do próprio dia (50 + 7)');
  eq(await page.evaluate(() => saldoContaEm('SemSaldo', '2026-12-31')), undefined, 'sem saldo inicial → undefined');
  // variações do saldo inicial
  await poe(page, { tx: [T(1, { conta: 'A', valor: 10, data: '2026-01-01' })], contas: ['A', 'B', 'C', 'Outros'], saldos: { A: { valor: 0, em: '2026-01-01' }, B: { valor: '100', em: '2026-01-01' }, C: { valor: 5 } } });
  eq(await page.evaluate(() => [temSaldoInicial('A'), temSaldoInicial('B'), temSaldoInicial('C'), temSaldoInicial('Z')].map(Boolean)), [true, false, true, false], 'temSaldoInicial: 0 conta como informado; texto "100" não; sem "em" sim; inexistente não');
  eqC(await saldo(page, 'A'), -10, 'saldo inicial 0 + gasto pago de 10 = −10 (conta negativa)');
  eqC(await saldo(page, 'B'), 0, 'saldo inicial como texto é ignorado (base 0) e o lançamento da conta B não existe → 0');
  await poe(page, { tx: [T(1, { conta: 'C', valor: 4, data: '2020-05-05' })], contas: ['C', 'Outros'], saldos: { C: { valor: 5 } } });
  eqC(await saldo(page, 'C'), 1, 'saldo inicial SEM data: conta todo o histórico (5 − 4)');
  // IR: cenário do plano (saldo inicial 1000 em 01/01/2026)
  await poe(page, {
    tx: [T(1, { conta: 'IR', tipo: 'receita', categoria: 'Receita', valor: 500, data: '2026-06-10' }), T(2, { conta: 'IR', valor: 200, data: '2026-08-10' }), T(3, { conta: 'IR', valor: 300, data: '2026-11-10', status: 'pendente' })],
    contas: ['IR', 'Outros'], saldos: { IR: { valor: 1000, em: '2026-01-01' } },
  });
  eqC(await page.evaluate(() => saldoContaEm('IR', '2026-12-31')), 1300, 'saldoContaEm(31/12): 1000 + 500 − 200, gasto PENDENTE de 300 não conta');

  // ================= 3. "Você tem hoje" =================
  console.log('3. "Você tem hoje" (faixa)');
  // cenário completo: mesmo CEN + pendências para o Fim do mês
  const EXTRA = [
    T(20, { conta: 'Nubank', valor: 80, data: '2026-09-28', status: 'pendente', grupoParcela: 'gp', desc: 'TV (2/3)' }),                // parcela em aberto: 80
    T(21, { conta: 'Nubank', tipo: 'receita', categoria: 'Receita', valor: 500, data: '2026-09-30', status: 'pendente' }),                // receita a receber: 500
    T(22, { conta: 'Itaú', valor: 100, categoria: 'Moradia', desc: 'Internet', data: '2026-09-08' }),                                    // fixo JÁ lançado (pago): não é "falta"
  ];
  const REC = [
    { id: 1, tipo: 'gasto', desc: 'Aluguel', valor: 1000, categoria: 'Moradia' },   // NÃO lançado em setembro → 1000 de "falta"
    { id: 2, tipo: 'gasto', desc: 'Internet', valor: 100, categoria: 'Moradia' },   // lançado em setembro (T22) → 0
    { id: 3, tipo: 'receita', desc: 'Salário', valor: 4000, categoria: 'Receita' }, // receita → nunca é "falta"
  ];
  const TODOS = [...CEN, ...EXTRA];
  await poe(page, { tx: TODOS, contas: ['Nubank', 'Itaú', 'Outros'], saldos: SALDOS, rec: REC });
  // T22 (Itaú, −100, pago, 08/09) reduz o Itaú: 329,20 − 100 = 229,20; total = 3100 + 229,20 = 3329,20
  eqC(await saldo(page, 'Itaú'), 229.2, 'Itaú com a Internet paga: 329,20 − 100 = 229,20');
  eqC(await num(page, 'dsValor'), 3329.2, 'faixa: valor = 3100 + 229,20');
  eq(await txt(page, '#dsLabel'), 'Você tem hoje', 'rótulo "Você tem hoje" (há contas com saldo inicial)');
  eq(await txt(page, '#dsSub'), 'Somando 2 contas', 'subtítulo "Somando 2 contas"');
  eq(await page.evaluate(() => document.getElementById('dsValor').classList.contains('neg')), false, 'valor positivo sem classe .neg');
  await poe(page, { tx: TODOS, contas: ['Nubank', 'Itaú', 'Outros'], saldos: SALDOS, rec: REC, filtro: 'Itaú' });
  eqC(await num(page, 'dsValor'), 229.2, 'com o filtro de conta = Itaú, a faixa mostra só o Itaú');
  eq(await txt(page, '#dsSub'), 'Em 1 conta', 'subtítulo "Em 1 conta"');
  await poe(page, { tx: TODOS, contas: ['Nubank', 'Itaú', 'Outros'], saldos: SALDOS, rec: REC, mes: '2026-08' });
  eq(await page.evaluate(() => getComputedStyle(document.getElementById('dobraSaldo')).display), 'none', 'fora do mês corrente (agosto): a faixa some');
  eq(await page.evaluate(() => getComputedStyle(document.getElementById('livreCard')).display), 'none', 'fora do mês corrente: o card "Fim do mês" some');
  // sem saldo inicial: resultado do mês
  await poe(page, { tx: [T(1, { tipo: 'receita', categoria: 'Receita', valor: 3000, data: '2026-09-02' }), T(2, { valor: 400, data: '2026-09-03' }), T(3, { valor: 300, data: '2026-09-20', status: 'pendente' })], contas: ['Nubank', 'Outros'] });
  eq(await txt(page, '#dsLabel'), 'Resultado do mês até agora', 'sem saldo inicial: rótulo "Resultado do mês até agora"');
  eqC(await num(page, 'dsValor'), 2600, 'sem saldo inicial: receita do mês − gasto PAGO (3000 − 400; o pendente não entra)');
  // frases de status
  const classe = (p) => p.evaluate(() => document.getElementById('dsStatus').className.replace('ds-status ', ''));
  await poe(page, { tx: [T(1, { valor: 50, data: '2026-09-03' })], contas: ['Nubank', 'Outros'], saldos: { Nubank: { valor: 30, em: '2026-09-01' } } });
  eq(await classe(page), 'estoura', 'saldo ≤ 0 → status "estoura" ("no vermelho")');
  await poe(page, { tx: [], contas: ['Nubank', 'Outros'], saldos: { Nubank: { valor: 500, em: '2026-09-01' } } });
  eq(await classe(page), 'ok', 'sem gastos no mês → "ok"');
  await poe(page, { tx: [T(1, { valor: 100, data: '2026-09-03' })], contas: ['Nubank', 'Outros'], saldos: { Nubank: { valor: 1100, em: '2026-09-01' } } });
  // saldo hoje = 1000; gasto 100 em 10 dias = 10/dia → dura 100 dias ≥ 20 restantes → ok
  eq(await classe(page), 'ok', 'saldo 1000, ritmo 10/dia, 20 dias restantes → "ok"');
  await poe(page, { tx: [T(1, { valor: 600, data: '2026-09-03' })], contas: ['Nubank', 'Outros'], saldos: { Nubank: { valor: 1000, em: '2026-09-01' } } });
  // saldo 400; 600 em 10 dias = 60/dia → dura 6 dias; folga = 20 − 6 = 14 > 5 → estoura, "dia 16"
  eq(await classe(page), 'estoura', 'saldo 400 a 60/dia (dura 6 dias, faltam 20) → "estoura"');
  ok(/acaba dia 16/.test(await txt(page, '#dsStatus')), '… e a frase diz "acaba dia 16"');

  // ================= 4. Fim do mês =================
  console.log('4. "Fim do mês" (contas à mão)');
  await poe(page, { tx: TODOS, contas: ['Nubank', 'Itaú', 'Outros'], saldos: SALDOS, rec: REC });
  // Você tem hoje 3329,20
  // + ainda vai receber 500 (receita pendente de setembro)
  // − ainda falta pagar: contas a vencer 420 (300 pendente + 120 VENCIDA) + parcelas 80 + fixos não lançados 1000 (Aluguel) = 1500
  // = 3329,20 + 500 − 1500 = 2329,20 ; 21 dias restantes → 110,91/dia
  const L = await linhas(page);
  eq(L, [['Você tem hoje', R(3329.2)], ['+ Ainda vai receber', R(500)], ['− Ainda falta pagar', R(1500)], ['  Contas a vencer', R(420)], ['  Parcelas em aberto', R(80)], ['  Fixos ainda não lançados', R(1000)], ['= Sobra', R(2329.2)]], 'detalhe: 3.329,20 + 500 − (420 + 80 + 1.000) = 2.329,20');
  eqC(await num(page, 'livreValor'), 2329.2, 'manchete = 2.329,20');
  eq(await txt(page, '#livreTitulo'), 'Depois de pagar as contas de setembro, você fica com', 'frase positiva');
  ok(/São R\$\s?110,91 por dia até o fim do mês\./.test(await txt(page, '#livrePorDia')), '21 dias restantes (10→30): 2.329,20 / 21 = 110,91 por dia');
  eq(await page.evaluate(() => document.getElementById('livreCard').classList.contains('neg')), false, 'card sem .neg');
  // vencidas entram; pagas não; mês seguinte não
  await poe(page, { tx: [T(1, { valor: 100, data: '2026-09-02', status: 'pendente' }), T(2, { valor: 50, data: '2026-09-03' }), T(3, { valor: 70, data: '2026-10-05', status: 'pendente' })], contas: ['Nubank', 'Outros'], saldos: { Nubank: { valor: 1000, em: '2026-09-01' } } });
  // saldo hoje = 1000 − 50 (pago) = 950 ; falta = 100 (vencida de 02/09) ; out/pendente de outubro NÃO → 850
  eqC(await num(page, 'livreValor'), 850, 'vencida (02/09, pendente) ENTRA; paga não; pendente de outubro não → 950 − 100 = 850');
  // meses anteriores
  await poe(page, { tx: [T(1, { valor: 200, data: '2026-08-10', status: 'pendente' }), T(2, { valor: 100, data: '2026-09-02', status: 'pendente' })], contas: ['Nubank', 'Outros'], saldos: { Nubank: { valor: 1000, em: '2026-08-01' } } });
  eqC(await num(page, 'livreValor'), 900, 'observação: conta VENCIDA de agosto (200) não entra no "Fim do mês" de setembro — só as do mês corrente (1000 − 100 = 900)');
  // falta
  await poe(page, { tx: [T(1, { valor: 800, data: '2026-09-20', status: 'pendente' })], contas: ['Nubank', 'Outros'], saldos: { Nubank: { valor: 300, em: '2026-09-01' } } });
  eq(await txt(page, '#livreTitulo'), 'Para cobrir as contas de setembro, faltam', 'resultado negativo: "Para cobrir as contas de setembro, faltam"');
  eqC(await num(page, 'livreValor'), 500, 'o valor mostrado é o módulo (300 − 800 = −500 → 500)');
  eq(await page.evaluate(() => document.getElementById('livreCard').classList.contains('neg')), true, 'card ganha .neg');
  ok(/Sem contar isso, seu mês fecha no vermelho/.test(await txt(page, '#livrePorDia')), 'texto "fecha no vermelho"');
  eq((await linhas(page)).slice(-1), [['= Falta', R(500)]], 'última linha "= Falta"');
  // fixo lançado por recorrenteId e por desc+categoria; fixo de outro mês não vale
  await poe(page, {
    tx: [T(1, { valor: 100, data: '2026-09-03', recorrenteId: 1, desc: 'qualquer coisa' }), T(2, { valor: 60, data: '2026-09-04', desc: 'Luz', categoria: 'Moradia' }), T(3, { valor: 90, data: '2026-08-04', desc: 'Gás', categoria: 'Moradia' })],
    contas: ['Nubank', 'Outros'], saldos: { Nubank: { valor: 1000, em: '2026-09-01' } },
    rec: [{ id: 1, tipo: 'gasto', desc: 'Net', valor: 100, categoria: 'Moradia' }, { id: 2, tipo: 'gasto', desc: 'Luz', valor: 60, categoria: 'Moradia' }, { id: 3, tipo: 'gasto', desc: 'Gás', valor: 90, categoria: 'Moradia' }],
  });
  eq((await linhas(page)).filter(l => /Fixos/.test(l[0])), [['  Fixos ainda não lançados', R(90)]], 'fixo conta como lançado por recorrenteId OU por desc+categoria no mês; lançamento de OUTRO mês não vale (só "Gás" falta)');
  // ================= pacote E: "sem saldo inicial" e o ritmo do "dura até" =================
  // Condição exata no código: `temSaldoInicial(nome)` = saldosIniciais[nome] existe E typeof valor === 'number'.
  //   conta sem entrada → "sem" · valor texto/null/ausente → "sem" · valor 0 → COM (partidaReal) · valor sem data → COM (conta todo o histórico)
  //   · data futura → COM. "Sem saldo inicial" = NENHUMA conta atende essa condição (partidaReal=false → "Resultado do mês até agora").
  // Cenário do recém-chegado: salário pago 1.000 (02/09), freela pendente 500 (30/09), mercado pago 200 (04/09).
  const NOVO = [T(1, { tipo: 'receita', categoria: 'Receita', valor: 1000, data: '2026-09-02' }), T(2, { tipo: 'receita', categoria: 'Receita', valor: 500, data: '2026-09-30', status: 'pendente' }), T(3, { valor: 200, data: '2026-09-04' })];
  const lerBandaEFim = async () => ({ banda: await txt(page, '#dsLabel'), ds: await num(page, 'dsValor'), livre: await num(page, 'livreValor'), titulo: await txt(page, '#livreTitulo') });
  const casosSemSaldo = [
    ['conta SEM entrada em saldosIniciais', {}],
    ['entrada com valor em TEXTO ("100")', { Nubank: { valor: '100', em: '2026-09-01' } }],
    ['entrada com valor null', { Nubank: { valor: null, em: '2026-09-01' } }],
    ['entrada só com a data (sem valor)', { Nubank: { em: '2026-09-01' } }],
  ];
  for(const [rotulo, saldos] of casosSemSaldo){
    await poe(page, { tx: NOVO, contas: ['Nubank', 'Outros'], saldos });
    const r = await lerBandaEFim();
    eq([r.banda, r.ds, r.livre], ['Resultado do mês até agora', 800, 1300], `sem saldo inicial (${rotulo}): "Resultado do mês até agora" = 800 (só o que JÁ entrou) e "Fim do mês" = 1.300 (a receita pendente de 500 conta UMA vez)`);
  }
  const casosComSaldo = [
    ['valor 0 com data', { Nubank: { valor: 0, em: '2026-09-01' } }, 800, 1300],
    ['valor 0 SEM data (conta todo o histórico)', { Nubank: { valor: 0 } }, 800, 1300],
    ['valor 100 com data', { Nubank: { valor: 100, em: '2026-09-01' } }, 900, 1400],
    ['valor 100 com data FUTURA (nada anterior conta)', { Nubank: { valor: 100, em: '2026-09-20' } }, 100, 600],
  ];
  for(const [rotulo, saldos, esperadoDs, esperadoLivre] of casosComSaldo){
    await poe(page, { tx: NOVO, contas: ['Nubank', 'Outros'], saldos });
    const r = await lerBandaEFim();
    eq([r.banda, r.ds, r.livre], ['Você tem hoje', esperadoDs, esperadoLivre], `COM saldo inicial (${rotulo}): "Você tem hoje" = ${esperadoDs} e "Fim do mês" = ${esperadoLivre} (a receita pendente conta uma vez)`);
  }
  // filtro de conta: a faixa respeita; o "Fim do mês" ignora o filtro
  await poe(page, { tx: [...NOVO, T(9, { conta: 'Itaú', valor: 50, data: '2026-09-03' })], contas: ['Nubank', 'Itaú', 'Outros'], saldos: { Nubank: { valor: 0, em: '2026-09-01' } }, filtro: 'Itaú' });
  let rf = await lerBandaEFim();
  eq([rf.banda, rf.ds], ['Resultado do mês até agora', -50], 'filtro numa conta SEM saldo (Itaú) enquanto outra tem: a faixa cai em "Resultado do mês até agora" só dessa conta (−50: nenhuma receita nela)');
  eq(rf.livre, 1300, '… e o "Fim do mês" ignora o filtro de conta (usa as contas com saldo: Nubank 800 + 500 pendente = 1.300)');
  // + uma conta a pagar pendente: 800 + 500 − 100 = 1.200
  const NOVO2 = [...NOVO, T(4, { valor: 100, data: '2026-09-20', status: 'pendente', desc: 'Internet' })];
  await poe(page, { tx: NOVO2, contas: ['Nubank', 'Outros'], saldos: {} });
  let r2 = await lerBandaEFim();
  eq([r2.ds, r2.livre], [800, 1200], 'recém-chegado com a receita pendente E uma conta a pagar (100): hoje 800 · fim do mês 800 + 500 − 100 = 1.200 (cada valor uma vez só)');
  eq((await linhas(page)).slice(0, 4), [['Resultado do mês até agora', R(800)], ['+ Ainda vai receber', R(500)], ['− Ainda falta pagar', R(100)], ['  Contas a vencer', R(100)]], 'detalhe do card: 800 + 500 − 100 (a receita pendente aparece só na linha "Ainda vai receber")');
  // sem receita pendente: nada muda (regressão do caminho comum)
  await poe(page, { tx: [NOVO[0], NOVO[2]], contas: ['Nubank', 'Outros'], saldos: {} });
  r2 = await lerBandaEFim();
  eq([r2.ds, r2.livre], [800, 800], 'sem receita pendente: hoje 800 e fim do mês 800 (inalterado)');
  // receita pendente vencida (data passada, não recebida) também não é "o que você tem hoje"
  await poe(page, { tx: [NOVO[0], T(5, { tipo: 'receita', categoria: 'Receita', valor: 300, data: '2026-09-05', status: 'pendente' })], contas: ['Nubank', 'Outros'], saldos: {} });
  r2 = await lerBandaEFim();
  eq([r2.ds, r2.livre], [1000, 1300], 'receita pendente JÁ VENCIDA (05/09, não recebida): não entra em "hoje" (1.000) e entra uma vez em "ainda vai receber" (1.300)');
  // "dura até": o ritmo usa só o que já foi PAGO até hoje
  await poe(page, { tx: [...NOVO, T(6, { valor: 900, data: '2026-09-28', status: 'pendente', desc: 'Aluguel' })], contas: ['Nubank', 'Outros'], saldos: {} });
  eq(await classe(page), 'ok', 'novo usuário com aluguel pendente de 900 no dia 28: o ritmo é 200 pagos / 10 dias = R$ 20/dia → "ok" (o aluguel NÃO entra no ritmo)');
  ok((await txt(page, '#dsStatus')).includes('No ritmo atual (R$ 20,00/dia), seu dinheiro dura até o fim do mês com folga.'), 'e a frase diz "No ritmo atual (R$ 20,00/dia), seu dinheiro dura até o fim do mês com folga."');
  await poe(page, { tx: [T(1, { valor: 100, data: '2026-09-03' }), T(2, { valor: 900, data: '2026-09-28', status: 'pendente', desc: 'Aluguel' })], contas: ['Nubank', 'Outros'], saldos: { Nubank: { valor: 1100, em: '2026-09-01' } } });
  eq(await classe(page), 'ok', 'com saldo inicial: o aluguel PENDENTE de 28/09 não entra no ritmo (100 pagos em 10 dias = 10/dia) → "ok"');
  await poe(page, { tx: [T(1, { valor: 600, data: '2026-09-03' }), T(2, { valor: 50, data: '2026-09-04', status: 'pendente' }), T(3, { valor: 50, data: '2026-09-25' })], contas: ['Nubank', 'Outros'], saldos: { Nubank: { valor: 1000, em: '2026-09-01' } } });
  ok(/acaba dia 16/.test(await txt(page, '#dsStatus')), 'pago com data FUTURA (25/09) e pendente também não contam no ritmo: só os 600 pagos até hoje → 60/dia, saldo 400 → "acaba dia 16" (igual ao caso sem eles)');

  // ================= 5. ponto flutuante =================
  console.log('5. ponto flutuante — somas que fecham ao centavo');
  await poe(page, { tx: [T(1, { tipo: 'receita', categoria: 'Receita', valor: 0.3 }), T(2, { valor: 0.1 }), T(3, { valor: 0.2 })] });
  eq([await lerId(page, 'kpiReceita'), await lerId(page, 'kpiGasto')], [R(0.3), R(0.3)], 'Entrou 0,30 e Saiu 0,10 + 0,20 = 0,30');
  eq(await lerId(page, 'kpiSaldo'), 'R$ 0,00', '0,30 − (0,10 + 0,20) fecha ao centavo: "R$ 0,00" (antes: "-R$ 0,00" por resíduo de −5,5e-17)');
  eq(await page.evaluate(() => document.getElementById('kpiSaldoLabel').textContent), 'Sobrou', 'rótulo segue "Sobrou"');
  await poe(page, { tx: Array.from({ length: 10 }, (_, i) => T(i + 1, { valor: 0.1 })) });
  eq(await lerId(page, 'kpiGasto'), R(1), '10 × 0,10 exibe R$ 1,00 (soma 0,9999999999999999 arredondada na exibição)');
  await poe(page, { tx: [T(1, { valor: 33.33 }), T(2, { valor: 33.33 }), T(3, { valor: 33.34 })] });
  eq(await lerId(page, 'kpiGasto'), R(100), '33,33 + 33,33 + 33,34 = R$ 100,00');
  await poe(page, { tx: [T(1, { valor: 1.005 }), T(2, { valor: 2.675 })] });
  eq(await lerId(page, 'kpiGasto'), R(3.68), '1,005 + 2,675 = 3,68 (soma 3,6799999… arredonda para 3,68)');
  // saldo por conta com decimais
  await poe(page, { tx: [T(1, { tipo: 'receita', categoria: 'Receita', valor: 0.2, data: '2026-09-02' })], contas: ['Nubank', 'Outros'], saldos: { Nubank: { valor: 0.1, em: '2026-09-01' } } });
  eq(await lerId(page, 'dsValor'), R(0.3), 'saldo 0,10 + receita 0,20 exibe R$ 0,30');
  // Fim do mês com resultado exatamente zero em decimais
  await poe(page, { tx: [T(1, { valor: 0.1, data: '2026-09-20', status: 'pendente' }), T(2, { valor: 0.2, data: '2026-09-21', status: 'pendente' })], contas: ['Nubank', 'Outros'], saldos: { Nubank: { valor: 0.3, em: '2026-09-01' } } });
  eq(await txt(page, '#livreTitulo'), 'Depois de pagar as contas de setembro, você fica com', 'saldo 0,30 e contas a pagar 0,10 + 0,20 (sobra exatamente R$ 0,00): "você fica com R$ 0,00" (antes: "faltam R$ 0,00" no vermelho)');
  // orçamento no limite exato
  await poe(page, { tx: Array.from({ length: 10 }, (_, i) => T(i + 1, { valor: 0.1, categoria: 'Lazer' })) });
  await page.evaluate(async () => { orcamentos = { Lazer: 1 }; await salvarOrc(); render(); });
  eq(await page.evaluate(() => [...document.querySelectorAll('#listaOrcamentoRisco .orc-val')].map(e => e.textContent.replace(/\s+/g, ' ').trim())), ['estourou · R$ 1,00 / R$ 1,00'], '10 × R$ 0,10 contra limite de R$ 1,00 (soma 0,9999999999999999): mostra "estourou" (antes: "100%" sem estourar)');

  // ================= 6. faturas de cartão =================
  console.log('6. faturas de cartão — ciclo, fechamento e vencimento');
  const ciclo = (f, v) => page.evaluate(([f, v]) => calcularCicloFatura(f, v), [f, v]);
  // hoje = 10/09/2026; fecha 25, vence 05 (mês seguinte porque 5 < 25)
  eq(await ciclo(25, 5), { inicioISO: '2026-08-25', fimISO: '2026-09-25', vencimentoISO: '2026-10-05' }, 'hoje 10/09, fecha 25, vence 05 → ciclo 25/08–25/09, vence 05/10');
  eq((await ciclo(10, 20)).vencimentoISO, '2026-09-20', 'vencimento > fechamento: no MESMO mês (fecha 10, vence 20)');
  eq((await ciclo(25, 25)).vencimentoISO, '2026-09-25', 'vencimento == fechamento: mesmo mês');
  eq((await ciclo(25, null)).vencimentoISO, null, 'sem vencimento → null');
  eq(await ciclo(31, 5), { inicioISO: '2026-08-31', fimISO: '2026-09-30', vencimentoISO: '2026-10-05' }, 'fecha dia 31 em mês de 30 dias → fecha dia 30 (inicia 31/08)');
  // fronteira do dia do fechamento
  await setRelogio(page, '2026-09-24T12:00:00-03:00');
  eq((await ciclo(25, 5)).fimISO, '2026-09-25', 'véspera do fechamento (24/09): ciclo fecha amanhã');
  await setRelogio(page, '2026-09-25T12:00:00-03:00');
  eq(await ciclo(25, 5), { inicioISO: '2026-08-25', fimISO: '2026-09-25', vencimentoISO: '2026-10-05' }, 'NO dia do fechamento (25/09): o ciclo ainda é o que fecha hoje');
  await setRelogio(page, '2026-09-26T12:00:00-03:00');
  eq(await ciclo(25, 5), { inicioISO: '2026-09-25', fimISO: '2026-10-25', vencimentoISO: '2026-11-05' }, 'dia seguinte (26/09): vira o ciclo 25/09–25/10, vence 05/11');
  // virada de ano e fevereiro
  await setRelogio(page, '2026-12-28T12:00:00-03:00');
  eq(await ciclo(25, 5), { inicioISO: '2026-12-25', fimISO: '2027-01-25', vencimentoISO: '2027-02-05' }, 'dezembro → janeiro: ciclo 25/12–25/01, vence 05/02/2027');
  await setRelogio(page, '2027-02-10T12:00:00-03:00');
  eq(await ciclo(30, 10), { inicioISO: '2027-01-30', fimISO: '2027-02-28', vencimentoISO: '2027-03-10' }, 'fevereiro/2027 (28 dias), fecha dia 30 → dia 28; vence 10/03');
  await setRelogio(page, '2028-02-10T12:00:00-03:00');
  eq((await ciclo(30, 10)).fimISO, '2028-02-29', 'fevereiro/2028 (bissexto) → dia 29');
  await setRelogio(page, FIX);
  // card de faturas
  const CART = [
    T(1, { conta: 'Cartão', valor: 100, data: '2026-08-25' }),   // dia do fechamento ANTERIOR → fatura passada (início é exclusivo)
    T(2, { conta: 'Cartão', valor: 10, data: '2026-08-26' }),    // 1º dia do ciclo
    T(3, { conta: 'Cartão', valor: 20, data: '2026-09-10', status: 'pendente' }), // pendente conta
    T(4, { conta: 'Cartão', valor: 5, data: '2026-09-25' }),     // NO dia do fechamento → fica nesta fatura
    T(5, { conta: 'Cartão', valor: 1000, data: '2026-09-26' }),  // dia seguinte → próxima fatura
    T(6, { conta: 'Cartão', tipo: 'receita', categoria: 'Receita', valor: 50, data: '2026-09-11' }), // estorno/receita não entra
    T(7, { conta: 'Outra', valor: 7, data: '2026-09-11' }),      // outra conta não entra
  ];
  await poe(page, { tx: CART, contas: ['Cartão', 'Outra', 'Outros'] });
  await page.evaluate(async () => { contasDetalhes = { 'Cartão': { tipo: 'cartao', diaFechamento: 25, diaVencimento: 5 } }; await salvarContas(); render(); });
  eq(await page.evaluate(() => getComputedStyle(document.getElementById('cardFaturas')).display), 'block', 'card de faturas aparece com um cartão configurado');
  eq(await page.evaluate(() => { const r = document.querySelector('#listaFaturas .orc-row'); return [r.querySelector('.orc-label').textContent, r.querySelector('.meta-sub').textContent.trim(), r.querySelector('.orc-val').textContent.replace(/\s+/g, ' ')]; }),
    ['Cartão', 'Fecha em 25/09/2026 · vence 05/10/2026', R(35)], 'fatura aberta: 10 + 20 (pendente) + 5 (no dia do fechamento) = R$ 35; 25/08 e 26/09 ficam de fora');
  await page.evaluate(async () => { contasDetalhes = { 'Cartão': { tipo: 'cartao', diaFechamento: 25 } }; await salvarContas(); render(); });
  ok(/vence não definido/.test(await txt(page, '#listaFaturas .meta-sub')), 'sem dia de vencimento: "vence não definido"');
  await page.evaluate(async () => { contasDetalhes = { 'Cartão': { tipo: 'cartao', diaFechamento: null } }; await salvarContas(); render(); });
  eq(await page.evaluate(() => getComputedStyle(document.getElementById('cardFaturas')).display), 'none', 'cartão sem dia de fechamento: o card some');
  await page.evaluate(async () => { contasDetalhes = { 'Cartão': { tipo: 'conta', diaFechamento: 25 } }; await salvarContas(); render(); });
  eq(await page.evaluate(() => getComputedStyle(document.getElementById('cardFaturas')).display), 'none', 'conta que não é cartão: o card some');
  // no dia 26 a fatura mostrada é a seguinte
  await page.evaluate(async () => { contasDetalhes = { 'Cartão': { tipo: 'cartao', diaFechamento: 25, diaVencimento: 5 } }; await salvarContas(); });
  await setRelogio(page, '2026-09-26T12:00:00-03:00');
  await page.evaluate(() => render());
  eq(await page.evaluate(() => [document.querySelector('#listaFaturas .meta-sub').textContent.trim(), document.querySelector('#listaFaturas .orc-val').textContent.replace(/\s+/g, ' ')]), ['Fecha em 25/10/2026 · vence 05/11/2026', R(1000)], 'em 26/09 a fatura aberta é a seguinte (25/09–25/10): só a compra de 26/09 (R$ 1.000)');
  await setRelogio(page, FIX);

  // parcelas
  console.log('6b. parcelas × fatura');
  await poe(page, { tx: [], contas: ['Cartão', 'Outros'] });
  await page.evaluate(async () => { contasDetalhes = { 'Cartão': { tipo: 'cartao', diaFechamento: 25, diaVencimento: 5 } }; await salvarContas(); });
  await page.evaluate(async () => {
    document.getElementById('tipo').value = 'gasto'; document.getElementById('descricao').value = 'TV'; document.getElementById('valor').value = '100';
    document.getElementById('conta').value = 'Cartão'; document.getElementById('dataInput').value = '2026-09-20'; document.getElementById('parcelas').value = '3';
    await adicionar();
  });
  const parc = await page.evaluate(() => transacoes.filter(t => t.grupoParcela).sort((a, b) => a.data.localeCompare(b.data)).map(t => [t.desc, t.data, t.valor, t.status]));
  eq(parc, [['TV (1/3)', '2026-09-20', 100, 'pago'], ['TV (2/3)', '2026-10-20', 100, 'pendente'], ['TV (3/3)', '2026-11-20', 100, 'pendente']], 'compra 3x: uma parcela por mês no mesmo dia; valor informado é POR parcela; a 1ª usa o status do form, as outras ficam pendentes');
  eq(await page.evaluate(() => document.querySelector('#listaFaturas .orc-val').textContent.replace(/\s+/g, ' ')), R(100), 'fatura de 10/09 (até 25/09): só a 1ª parcela (R$ 100)');
  await setRelogio(page, '2026-09-26T12:00:00-03:00');
  await page.evaluate(() => render());
  eq(await page.evaluate(() => document.querySelector('#listaFaturas .orc-val').textContent.replace(/\s+/g, ' ')), R(100), 'fatura seguinte (26/09 → 25/10): a 2ª parcela (20/10) cai nela, a 1ª fica na anterior');
  await setRelogio(page, '2026-10-26T12:00:00-03:00');
  await page.evaluate(() => render());
  eq(await page.evaluate(() => document.querySelector('#listaFaturas .orc-val').textContent.replace(/\s+/g, ' ')), R(100), 'e a 3ª parcela (20/11) cai na fatura de 25/10–25/11');
  await setRelogio(page, FIX);
  // compra parcelada no dia do fechamento
  const dtp = (d, n) => page.evaluate(([d, n]) => addMeses(d, n), [d, n]);
  eq(await dtp('2026-09-25', 1), '2026-10-25', 'parcela de uma compra no dia do fechamento (25/09) vence em 25/10 = dia do próximo fechamento (fica na MESMA fatura que fecha nesse dia)');
  eq(await dtp('2026-12-15', 1), '2027-01-15', 'addMeses atravessa o ano');
  eq(await dtp('2026-01-31', 1), '2026-02-28', 'addMeses("2026-01-31", 1) = 28/02 (limita ao último dia do mês de destino; antes estourava para 03/03 e a parcela pulava uma fatura inteira)');
  eq(await dtp('2026-08-31', 1), '2026-09-30', 'addMeses("2026-08-31", 1) = 30/09 (setembro só tem 30 dias; antes: 01/10)');
  eq(await dtp('2026-01-30', 1), '2026-02-28', 'addMeses("2026-01-30", 1) = 28/02 (antes: 02/03)');
  eq(await dtp('2028-01-31', 1), '2028-02-29', 'mesmo em ano bissexto: 31/01/2028 + 1 mês = 29/02 (antes: 02/03)');
  // ---- pacote D: dias 29/30/31 em TODOS os meses, contra um oráculo independente (tabela de dias por mês + regra de bissexto)
  const bissexto = (a) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
  const diasNoMes = (a, m) => [31, bissexto(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  const p2 = (n) => String(n).padStart(2, '0');
  const oraculo = (a, m, d, n) => { let t = (a * 12 + (m - 1)) + n; const aa = Math.floor(t / 12), mm = (t % 12 + 12) % 12 + 1; return `${aa}-${p2(mm)}-${p2(Math.min(d, diasNoMes(aa, mm)))}`; };
  const casos = [];
  for(const a of [2026, 2027, 2028, 2100, 2000]) for(let m = 1; m <= 12; m++) for(const d of [29, 30, 31]) if(d <= diasNoMes(a, m)) for(const n of [0, 1, 2, 12]) casos.push([`${a}-${p2(m)}-${p2(d)}`, n]);
  const got = await page.evaluate(cs => cs.map(([d, n]) => addMeses(d, n)), casos);
  const erros = casos.map(([d, n], i) => [d, n, got[i], oraculo(+d.slice(0, 4), +d.slice(5, 7), +d.slice(8, 10), n)]).filter(x => x[2] !== x[3]);
  eq(erros, [], `addMeses bate com o oráculo em ${casos.length} combinações (anos 2026/27/28/2100/2000 · todos os meses · dias 29/30/31 · +0/+1/+2/+12 meses)`);
  eq(await dtp('2026-12-31', 2), '2027-02-28', 'virada de ano: 31/12/2026 + 2 meses = 28/02/2027');
  eq(await dtp('2026-11-30', 3), '2027-02-28', 'virada de ano: 30/11/2026 + 3 meses = 28/02/2027');
  eq(await dtp('2026-03-31', -1), '2026-02-28', 'mês negativo: 31/03 − 1 mês = 28/02');
  eq(await dtp('2028-02-29', 12), '2029-02-28', '29/02/2028 + 12 meses = 28/02/2029 (ano seguinte não é bissexto)');
  eq(await dtp('2026-05-15', 0), '2026-05-15', '+0 meses devolve a própria data');
  // 12 parcelas a partir do dia 31: cada uma parte da data ORIGINAL (nunca da já limitada): 31/03, não 28/03
  const doze = await page.evaluate(() => Array.from({ length: 12 }, (_, i) => addMeses('2026-01-31', i)));
  eq(doze, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31'], '12 parcelas do dia 31: 31/01, 28/02, 31/03 (volta ao 31, não fica em 28), 30/04 … 31/12');
  // fluxo real pelo formulário: 3 parcelas a partir de 31/01 e 5 a partir de 30/12
  await poe(page, { tx: [], contas: ['Cartão', 'Outros'] });
  const viaForm = async (data, parcelas) => page.evaluate(async ([data, parcelas]) => {
    transacoes = [];
    document.getElementById('tipo').value = 'gasto'; document.getElementById('descricao').value = 'Compra'; document.getElementById('valor').value = '100';
    document.getElementById('conta').value = 'Cartão'; document.getElementById('dataInput').value = data; document.getElementById('parcelas').value = String(parcelas);
    await adicionar();
    return transacoes.filter(t => t.grupoParcela).sort((a, b) => a.data.localeCompare(b.data)).map(t => [t.desc, t.data]);
  }, [data, parcelas]);
  eq(await viaForm('2026-01-31', 3), [['Compra (1/3)', '2026-01-31'], ['Compra (2/3)', '2026-02-28'], ['Compra (3/3)', '2026-03-31']], 'formulário "Novo lançamento": 3x a partir de 31/01 → 31/01, 28/02, 31/03');
  eq((await viaForm('2026-12-30', 5)).map(x => x[1]), ['2026-12-30', '2027-01-30', '2027-02-28', '2027-03-30', '2027-04-30'], 'formulário: 5x a partir de 30/12 atravessa o ano e limita fevereiro (28/02/2027)');
  // outros pontos do app que somam meses: conta fixa sempre cai no dia 05 (nunca estoura) e a fatura tem ajuste próprio de fim de mês
  eq(await page.evaluate(() => { mesAtual = '2026-02'; recorrentes = [{ id: 1, tipo: 'gasto', desc: 'Fixa', valor: 1, categoria: 'Outros' }]; transacoes = []; lancarRecorrente(1); return transacoes[0].data; }), '2026-02-05', 'conta fixa: "Lançar este mês" usa sempre o dia 05 do mês selecionado (sem soma de meses, não estoura)');

  eq(page.__erros, [], 'nenhum erro de console/página');
  await browser.close();
  const t = res(); console.log(`\n${t.pass} ok, ${t.fail} fail`); process.exit(t.fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
