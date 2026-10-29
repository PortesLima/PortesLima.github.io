// Exportações: CSV (separador, aspas, quebra de linha, acentos, ida-e-volta) e PDF mensal/anual/IR
// (conteúdo confere com a tela: totais, contagem de linhas, páginas; mês vazio; textos hostis).
// O jsPDF é REAL; o construtor é espiado (texto desenhado por doc.text, páginas, tamanho) e o save()
// é interceptado (nenhum download). Caracteriza o comportamento ATUAL; o que parece errado leva
// [BUG-CONHECIDO] no nome do check. Relógio fixo 10/09/2026 12:00 BRT, PostHog bloqueado, sem waitForTimeout.
const { chromium, ok, abrir, res } = require('./lib');
const FIX = '2026-09-10T12:00:00-03:00';
const eq = (a, b, n) => { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, A === B ? n : `${n}  [obtido ${A} | esperado ${B}]`); };
const T = (id, o) => ({ tipo: 'gasto', desc: 'T' + id, valor: 1, categoria: 'Outros', conta: 'Outros', data: '2026-09-05', status: 'pago', ...o, id });
const REC = (id, o) => T(id, { tipo: 'receita', categoria: 'Receita', ...o });
const R = (v) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const poe = (page, { tx = [], mes = '2026-09', filtro = '', contas, saldos } = {}) => page.evaluate(async ([tx, mes, filtro, contasN, saldosN]) => {
  transacoes = tx; snapshotAnterior = null; if(contasN) contas = contasN; if(saldosN) saldosIniciais = saldosN;
  await salvarTx(); await salvarContas(); popularSelectsEstaticos();
  document.getElementById('contaFiltro').value = filtro;
  mesAtual = mes; popularSeletorMes(); document.getElementById('mesSel').value = mes; render();
}, [tx, mes, filtro, contas || null, saldos || null]);
const txt = (page, sel) => page.evaluate(s => document.querySelector(s).textContent.replace(/\s+/g, ' ').trim(), sel);
// executa uma exportação de PDF com o construtor espiado e devolve o que foi desenhado
const pdf = (page, fn) => page.evaluate(f => {
  const Orig = jspdf.jsPDF; const r = { texts: [], saves: [], paginas: 0, bytes: 0 };
  jspdf.jsPDF = function(...a){
    const d = new Orig(...a), tx = d.text.bind(d);
    d.text = function(t, x, y, o){ const s = Array.isArray(t) ? t.join(' ') : String(t); r.texts.push({ s, x, y, pag: d.internal.getCurrentPageInfo().pageNumber, w: d.getTextWidth(s) }); return tx(t, x, y, o); };
    d.save = n => { r.saves.push(n); r.paginas = d.internal.getNumberOfPages(); r.bytes = d.output('arraybuffer').byteLength; };
    return d;
  };
  jspdf.jsPDF.prototype = Orig.prototype;
  try{ window[f](); r.erro = null; }catch(e){ r.erro = String(e && e.message || e); }
  jspdf.jsPDF = Orig;
  return r;
}, fn);
const S = (r) => r.texts.map(t => t.s.replace(/[  ]/g, ' ')); // NBSP do toLocaleString → espaço comum
const tem = (r, s) => S(r).includes(s);
// parser CSV (RFC 4180, separador ';') independente do app — para conferir o que exportarCSV escreve
const csvParse = (texto) => {
  const linhas = []; let campo = '', linha = [], dentro = false;
  for(let i = 0; i < texto.length; i++){
    const c = texto[i];
    if(dentro){ if(c === '"'){ if(texto[i + 1] === '"'){ campo += '"'; i++; } else dentro = false; } else campo += c; }
    else if(c === '"') dentro = true;
    else if(c === ';'){ linha.push(campo); campo = ''; }
    else if(c === '\n'){ linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if(c !== '\r') campo += c;
  }
  if(campo !== '' || linha.length){ linha.push(campo); linhas.push(linha); }
  return linhas;
};
const exportarCSV = (page) => page.evaluate(async () => {
  let cap; const o = URL.createObjectURL; URL.createObjectURL = b => { cap = b; return o.call(URL, b); };
  exportarCSV(); URL.createObjectURL = o;
  return { texto: await cap.text(), bytes: [...new Uint8Array(await cap.arrayBuffer()).slice(0, 3)], tipo: cap.type };
});

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const { page } = await abrir(browser, { fixed: FIX });
  page.on('dialog', d => d.accept());
  await page.emulateMedia({ reducedMotion: 'reduce' }); // texto dos KPIs sem tween
  await page.reload({ waitUntil: 'load' });
  await page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => getComputedStyle(document.getElementById('telaInicial')).display === 'none');

  // ================= 1. CSV =================
  console.log('1. exportarCSV');
  const HOSTIL = 'Almoço; "Bar do Zé"\nsegunda linha, café';
  await poe(page, {
    tx: [
      T(1, { desc: HOSTIL, valor: 1234.5, data: '2026-09-15', categoria: 'Alimentação', conta: 'Conta; "A"', tag: 'a;b', fixo: true }),
      REC(2, { desc: 'Salário', valor: 15000, data: '2026-09-02' }),
      T(3, { desc: 'Ação, coração & pão — 100% ünïcödé', valor: 0.3, data: '2026-08-31' }),
      T(4, { desc: 'Conta vencida', valor: 99.99, data: '2026-09-01', status: 'pendente' }),
      T(5, { desc: 'Conta futura', valor: 10, data: '2026-09-30', status: 'pendente' }),
      T(6, { desc: 'Soma flutuante', valor: 0.1 + 0.2, data: '2026-09-06' }),
      T(7, { desc: 'Sem conta', valor: 7, data: '2026-09-07', conta: undefined }),
    ],
  });
  const csv = await exportarCSV(page);
  eq(csv.bytes, [0xEF, 0xBB, 0xBF], 'arquivo começa com BOM UTF-8 (Excel abre os acentos)');
  ok(/text\/csv/.test(csv.tipo) && /utf-8/i.test(csv.tipo), 'tipo MIME text/csv; charset=utf-8');
  const L = csvParse(csv.texto);
  eq(L[0], ['Data', 'Tipo', 'Descrição', 'Categoria', 'Conta', 'Status', 'Valor', 'Fixo', 'Tag'], 'cabeçalho com 9 colunas, separador ";"');
  ok(L.every(l => l.length === 9), 'TODAS as linhas têm 9 campos (aspas, ";" e quebra de linha dentro do texto não desalinham)');
  eq(L.length, 8, '1 cabeçalho + 7 lançamentos');
  eq(L.slice(1).map(l => l[0]), ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-06', '2026-09-07', '2026-09-15', '2026-09-30'], 'ordenado por data crescente');
  const porDesc = Object.fromEntries(L.slice(1).map(l => [l[2], l]));
  eq(porDesc[HOSTIL].slice(2, 9), [HOSTIL, 'Alimentação', 'Conta; "A"', 'pago', '1234,50', 'sim', 'a;b'], 'descrição com ";", aspas e quebra de linha sai íntegra; conta e tag com ";" também; valor "1234,50"; fixo "sim"');
  ok(csv.texto.includes('"Almoço; ""Bar do Zé""\nsegunda linha, café"'), 'aspas duplicadas ("") e a quebra de linha ficam DENTRO das aspas');
  eq(porDesc['Ação, coração & pão — 100% ünïcödé'][2], 'Ação, coração & pão — 100% ünïcödé', 'acentos, vírgula, & e travessão preservados');
  eq(porDesc['Conta vencida'][5], 'vencido', 'status exportado = statusEfetivo (pendente com data passada → "vencido")');
  eq(porDesc['Conta futura'][5], 'pendente', 'pendente futuro → "pendente"');
  eq(porDesc['Soma flutuante'][6], '0,30', '0,1 + 0,2 (0,30000000000000004) sai "0,30"');
  eq(porDesc['Salário'].slice(1, 9), ['receita', 'Salário', 'Receita', 'Outros', 'pago', '15000,00', 'não', ''], 'receita: tipo, categoria, valor sem separador de milhar, fixo "não", tag vazia');
  eq(porDesc['Sem conta'][4], '', 'sem conta → campo vazio');
  ok(!/R\$/.test(csv.texto), 'valores sempre em BRL cru, sem "R$" (independe da moeda de exibição)');
  // moeda de exibição não altera o CSV
  await page.evaluate(() => { moedaAtual = 'USD'; taxasCambio = { BRL: 1, USD: 0.2, EUR: 1, GBP: 1 }; });
  eq((csvParse((await exportarCSV(page)).texto)).slice(1).find(l => l[2] === 'Salário')[6], '15000,00', 'com a moeda de exibição em USD o CSV continua em BRL');
  await page.evaluate(() => { moedaAtual = 'BRL'; });
  // injeção de fórmula
  await poe(page, { tx: [T(1, { desc: '=HYPERLINK("http://x","clique")' }), T(2, { desc: '+1+1' }), T(3, { desc: '-2+3' }), T(4, { desc: '@SUM(1)' }), T(5, { desc: 'normal' })] });
  const f = csvParse((await exportarCSV(page)).texto).slice(1).map(l => l[2]).sort();
  eq(f.filter(d => /^[=+\-@]/.test(d)).length, 4, '[BUG-CONHECIDO] descrições que começam com = + - @ são exportadas SEM neutralização (Excel/Sheets as executam como fórmula — "CSV injection"); esperado: prefixar com apóstrofo');
  // ida e volta pelo parser do app
  await poe(page, { tx: [T(1, { desc: HOSTIL, valor: 1234.5 }), T(2, { desc: 'Simples; com "aspas"', valor: 10 }), REC(3, { desc: 'Salário', valor: 5000 })] });
  const rt = await page.evaluate(async () => { let cap; const o = URL.createObjectURL; URL.createObjectURL = b => { cap = b; return o.call(URL, b); }; exportarCSV(); URL.createObjectURL = o; return parseCSVBolsoCerto(await cap.text()).transacoes.map(t => [t.desc, t.valor]); });
  eq(rt.map(x => x[0]).sort(), ['Salário', 'Simples; com "aspas"'], '[BUG-CONHECIDO] ida e volta pelo parseCSVBolsoCerto PERDE o lançamento cuja descrição tem quebra de linha (o parser corta o texto em linhas antes de olhar as aspas) — some em silêncio; esperado: 3 lançamentos');
  eq(rt.find(x => x[0] === 'Simples; com "aspas"')[1], -10, 'sem quebra de linha, ";" e aspas sobrevivem à ida e volta');

  // ================= 2. PDF mensal =================
  console.log('2. exportarPDF (mensal)');
  const SET = [
    REC(1, { desc: 'Salário', valor: 3000, data: '2026-09-02' }),
    REC(2, { desc: 'Freela a receber', valor: 500, data: '2026-09-30', status: 'pendente' }),
    T(3, { desc: 'Mercado Çá', valor: 400, data: '2026-09-03', categoria: 'Alimentação' }),
    T(4, { desc: 'Conta vencida', valor: 120, data: '2026-09-05', status: 'pendente', conta: 'Itaú' }),
    T(5, { desc: 'Aluguel; "Casa"', valor: 1234.5, data: '2026-09-15', categoria: 'Moradia', conta: 'Itaú' }),
    { id: 6, tipo: 'transferencia', subtipo: 'saida', desc: 'Transf → Itaú', valor: 500, categoria: 'Transferência', conta: 'Outros', data: '2026-09-04', status: 'pago', grupoTransferencia: 'g' },
    { id: 7, tipo: 'transferencia', subtipo: 'entrada', desc: 'Transf ← Outros', valor: 500, categoria: 'Transferência', conta: 'Itaú', data: '2026-09-04', status: 'pago', grupoTransferencia: 'g' },
    REC(8, { desc: 'Sobra de agosto', valor: 100, data: '2026-08-10' }),
    T(9, { desc: 'Gasto de agosto', valor: 40, data: '2026-08-11' }),
  ];
  await poe(page, { tx: SET, contas: ['Outros', 'Itaú'] });
  // à mão: Entrou = 3000 + 500 (pendente conta) = 3500 ; Saiu = 400 + 120 + 1234,50 = 1754,50 ; Resultado = 1745,50
  //        transferências ficam fora dos totais mas entram na lista ; agosto: 100 − 40 = 60 ; taxa = round(1745,5/3500) = 50%
  let r = await pdf(page, 'exportarPDF');
  eq([r.erro, r.saves, r.paginas], [null, ['relatorio-2026-09.pdf'], 1], 'gera "relatorio-2026-09.pdf" em 1 página, sem erro');
  ok(r.bytes > 2000 && r.bytes < 60000, `arquivo leve (${r.bytes} bytes)`);
  ok(tem(r, 'Relatório mensal') && tem(r, 'Bolso Certo') && tem(r, 'set/2026'), 'cabeçalho: marca, "Relatório mensal" e referência "set/2026"');
  ok(tem(r, 'Gerado em 10/09/2026 às 12:00'), '"Gerado em 10/09/2026 às 12:00" (relógio fixo, fuso de São Paulo)');
  ok(tem(r, 'Resultado de set/2026'), 'rótulo "Resultado de set/2026"');
  ok(tem(r, R(1745.5)) && tem(r, 'Você fechou set/2026 no positivo — sobrou ' + R(1745.5) + '.'), 'resultado R$ 1.745,50 e a frase "no positivo"');
  ok(tem(r, R(3500)) && tem(r, R(1754.5)), 'Entrou R$ 3.500,00 e Saiu R$ 1.754,50 (transferências fora dos totais)');
  ok(tem(r, 'Você guardou 50% do que ganhou neste mês.'), 'taxa de poupança 50%');
  ok(tem(r, `Somando o que sobrou de ago/2026 (${R(60)}), você tem`) && tem(r, `${R(1805.5)} de set/2026`), 'linha "sobrou de ago/2026 (R$ 60,00)" e total 1.805,50');
  // confere com a tela
  eq([await txt(page, '#kpiReceita'), await txt(page, '#kpiGasto')], [R(3500), R(1754.5)], 'a TELA mostra o mesmo Entrou/Saiu que o PDF');
  const dias = r.texts.filter(t => /^\d{2}\/\d{2}$/.test(t.s) && t.x === 14);
  const linhasTela = await page.evaluate(() => document.querySelectorAll('#corpoTabela tr:not(.linha-ver-antigas)').length);
  ok(tem(r, '7 no mês'), 'contagem "7 no mês" (5 lançamentos + 2 pernas de transferência)');
  eq([dias.length, linhasTela], [7, 7], 'linhas desenhadas no PDF = linhas da tabela na tela = 7');
  eq(dias.map(t => t.s), ['02/09', '03/09', '04/09', '04/09', '05/09', '15/09', '30/09'], 'linhas em ordem de data');
  const vals = S(r).filter(s => /^[-+~] R\$ /.test(s));
  eq(vals.length, 7, '7 valores com sinal (+ receita, − gasto, ~ transferência)');
  ok(vals.includes('~ ' + R(500)) && vals.includes('- ' + R(1234.5)) && vals.includes('+ ' + R(3000)), 'sinais: "~" transferência, "-" gasto, "+" receita');
  const cents = (s) => Math.round(parseFloat(s.slice(2).replace('R$ ', '').replace(/\./g, '').replace(',', '.')) * 100);
  const somaLinhas = vals.filter(v => !v.startsWith('~')).reduce((a, v) => a + (v[0] === '+' ? 1 : -1) * cents(v), 0);
  eq(somaLinhas, 174550, 'soma das linhas (sem transferências) = Resultado, ao centavo');
  ok(tem(r, 'Aluguel; "Casa"') && tem(r, 'Mercado Çá'), 'descrições com acento, ";" e aspas desenhadas íntegras');
  ok(tem(r, 'Bolso Certo — set/2026') && tem(r, 'Página 1 de 1'), 'rodapé "Bolso Certo — set/2026" e "Página 1 de 1"');
  // sem saldo anterior
  await poe(page, { tx: SET.filter(t => !/agosto/.test(t.desc)), contas: ['Outros', 'Itaú'] });
  r = await pdf(page, 'exportarPDF');
  ok(!S(r).some(s => /Somando o que/.test(s)), 'sem movimento no mês anterior: a linha "Somando o que sobrou" NÃO aparece');
  // filtro de conta: a tela filtra, o PDF não
  await poe(page, { tx: SET, contas: ['Outros', 'Itaú'], filtro: 'Itaú' });
  const telaItau = [await txt(page, '#kpiReceita'), await txt(page, '#kpiGasto')];
  r = await pdf(page, 'exportarPDF');
  eq(telaItau, [R(0), R(1354.5)], 'tela com o filtro de conta = Itaú: Entrou 0 (as receitas estão em "Outros"), Saiu 1.354,50 (120 + 1.234,50)');
  ok(tem(r, R(3500)) && tem(r, R(1754.5)) && !tem(r, R(1354.5)), '[BUG-CONHECIDO] o PDF mensal IGNORA o filtro de conta do topo: sai com Entrou 3.500 / Saiu 1.754,50 (todas as contas) enquanto a tela mostra só o Itaú; esperado: respeitar o filtro (ou avisar)');
  // mês vazio
  await poe(page, { tx: [], mes: '2026-09' });
  r = await pdf(page, 'exportarPDF');
  eq([r.erro, r.saves, r.paginas], [null, ['relatorio-2026-09.pdf'], 1], 'mês vazio: gera sem erro, 1 página');
  ok(tem(r, 'Nenhum lançamento em set/2026.') && tem(r, 'Nenhum lançamento neste mês.') && tem(r, '0 no mês') && tem(r, R(0)), 'mês vazio: frases "Nenhum lançamento…", "0 no mês" e R$ 0,00');
  ok(!S(r).includes('DESCRIÇÃO'), 'mês vazio: sem cabeçalho de tabela');
  await poe(page, { tx: [REC(1, { valor: 10, data: '2026-01-10' })], mes: '2026-09' });
  r = await pdf(page, 'exportarPDF');
  ok(r.erro === null && tem(r, 'Nenhum lançamento neste mês.'), 'mês sem lançamentos mas com histórico em outro mês: sem erro');
  // várias páginas
  const MUITOS = Array.from({ length: 70 }, (_, i) => T(i + 1, { desc: 'Item ' + (i + 1), valor: 10 + i, data: '2026-09-' + String(1 + (i % 28)).padStart(2, '0') }));
  await poe(page, { tx: MUITOS });
  r = await pdf(page, 'exportarPDF');
  ok(r.paginas >= 2 && r.erro === null, `70 lançamentos: ${r.paginas} páginas, sem erro`);
  eq(r.texts.filter(t => /^\d{2}\/\d{2}$/.test(t.s) && t.x === 14).length, 70, 'as 70 linhas foram desenhadas (nenhuma se perde na quebra de página)');
  eq(r.texts.filter(t => t.s === 'Relatório mensal').length, r.paginas, 'o cabeçalho "Relatório mensal" é repetido em TODAS as páginas');
  eq(r.texts.filter(t => t.s === 'DESCRIÇÃO').length, r.paginas, 'o cabeçalho da tabela é repetido em todas as páginas');
  eq(Array.from({ length: r.paginas }, (_, i) => tem(r, `Página ${i + 1} de ${r.paginas}`)), Array(r.paginas).fill(true), 'rodapé "Página X de Y" em todas as páginas');
  const totalMuitos = MUITOS.reduce((s, t) => s + t.valor, 0);
  ok(tem(r, R(totalMuitos)) && tem(r, '70 no mês'), `totais (${R(totalMuitos)}) e "70 no mês" conferem`);
  // texto hostil
  await poe(page, { tx: [T(1, { desc: 'X'.repeat(200), valor: 5 }), T(2, { desc: 'Ação café coração 🍕 € ő', valor: 6 }), T(3, { desc: '<img src=x onerror=alert(1)> & "q"', valor: 7 }), T(4, { desc: 'quebra\nde linha', valor: 8 }), T(5, { desc: 'Categoria longa', valor: 9, categoria: 'C'.repeat(40) })] });
  r = await pdf(page, 'exportarPDF');
  eq(r.erro, null, 'descrição de 200 caracteres, emoji, símbolos, HTML e quebra de linha: gera sem erro');
  eq(await page.evaluate(() => document.querySelectorAll('#corpoTabela img[src="x"]').length), 0, 'a DESCRIÇÃO do lançamento é escapada na tabela de Lançamentos: nenhum <img> injetado');
  eq(page.__erros.filter(e => /ERR_FILE_NOT_FOUND/.test(e)).length, 0, '… e o navegador não tenta carregar "x" (nenhum erro de recurso)');
  page.__erros.length = 0;
  const longa = r.texts.find(t => t.x === 28 && t.s.startsWith('XXXX'));
  ok(longa && longa.s.endsWith('…') && longa.s.length < 200 && longa.w <= 78.01, `descrição de 200 caracteres é truncada com "…" e cabe na coluna (${longa && longa.w.toFixed(1)} ≤ 78 mm)`);
  ok(tem(r, 'Ação café coração 🍕 € ő') || S(r).some(s => s.startsWith('Ação café coração')), 'acentos preservados na descrição');
  ok(tem(r, '<img src=x onerror=alert(1)> & "q"'), 'HTML na descrição é desenhado como texto');
  ok(S(r).some(s => s.includes('\n')), '[BUG-CONHECIDO] descrição com quebra de linha vai crua para doc.text, que a desenha em 2 linhas e invade a linha seguinte da tabela; esperado: trocar a quebra por espaço');
  ok(S(r).includes('C'.repeat(16)), 'categoria longa é cortada em 16 caracteres no chip');
  // ponto flutuante
  await poe(page, { tx: [REC(1, { valor: 0.3 }), T(2, { valor: 0.1 }), T(3, { valor: 0.2 })] });
  r = await pdf(page, 'exportarPDF');
  ok(tem(r, '- ' + R(0)) && S(r).some(s => /você gastou R\$ 0,00 a mais do que ganhou/.test(s)), '[BUG-CONHECIDO] 0,30 de receita − (0,10 + 0,20) de gasto: o PDF diz "- R$ 0,00" e "você gastou R$ 0,00 a mais do que ganhou" (saldo −5,5e-17); esperado: "R$ 0,00" no positivo');
  await poe(page, { tx: [T(1, { valor: 0.1 }), T(2, { valor: 0.2 }), T(3, { valor: 0.3 }), T(4, { valor: 0.7 }), T(5, { valor: 1.1 }), T(6, { valor: 2.2 })] });
  r = await pdf(page, 'exportarPDF');
  const v6 = r.texts.filter(t => t.x > 150).map(t => t.s.replace(/[  ]/g, ' ')).filter(s => /^- R\$ /.test(s)).map(s => cents(s)) .reduce((a, b) => a + b, 0); // só a coluna VALOR das linhas (o número-herói fica em x=14)
  ok(tem(r, R(4.6)) && v6 === 460, `6 gastos decimais: o total do PDF (${R(4.6)}) é a soma exata das linhas em centavos (${v6})`);

  // categoria "" legada (pacote A2): o PDF mostra "Outros" no chip; o anual junta com o "Outros" real
  await poe(page, { tx: [T(1, { categoria: '', valor: 90 }), T(2, { categoria: 'Outros', valor: 5 })] });
  r = await pdf(page, 'exportarPDF');
  eq(S(r).filter(s => s === 'Outros').length, 2, 'PDF mensal: lançamento com categoria "" sai com o chip "Outros" (2 chips "Outros", nenhum vazio)');
  await page.evaluate(() => { document.getElementById('anoRelatorio').value = '2026'; });
  r = await pdf(page, 'exportarPDFAnual');
  ok(tem(r, '- ' + R(95)) && !tem(r, '- ' + R(90)), 'PDF anual: "Gastos por categoria" junta o "" com o "Outros" real numa linha só (− R$ 95,00)');
  r = await pdf(page, 'exportarPDFIR');
  ok(tem(r, '- ' + R(95)) && !tem(r, '- ' + R(90)), 'PDF de IR: gastos por categoria também junta o "" com "Outros" (− R$ 95,00)');
  const csvA2 = csvParse((await exportarCSV(page)).texto).slice(1).map(l => l[3]).sort();
  eq(csvA2, ['Outros', 'Outros'], 'o CSV exporta a categoria "" legada como "Outros" (o dado gravado não muda; só o arquivo sai completo)');
  eq(await page.evaluate(() => transacoes.map(t => t.categoria).sort()), ['', 'Outros'], '… e o dado gravado continua com "" (a exportação não reescreve nada)');

  // ================= 3. PDF anual =================
  console.log('3. exportarPDFAnual');
  const ANO = [
    REC(1, { valor: 3000, data: '2026-01-10' }), T(2, { valor: 1000, data: '2026-01-15', categoria: 'Moradia' }),
    REC(3, { valor: 2000, data: '2026-03-10' }), T(4, { valor: 500.5, data: '2026-03-20', categoria: 'Lazer' }), T(5, { valor: 200, data: '2026-03-21', categoria: 'Lazer' }),
    REC(6, { valor: 9999, data: '2025-12-31' }), T(7, { valor: 8888, data: '2025-06-01' }),
    { id: 8, tipo: 'transferencia', subtipo: 'saida', desc: 'T', valor: 300, categoria: 'Transferência', conta: 'Outros', data: '2026-02-02', status: 'pago', grupoTransferencia: 'g' },
  ];
  await poe(page, { tx: ANO });
  await page.evaluate(() => { document.getElementById('anoRelatorio').value = '2026'; });
  // à mão 2026: Entrou 5000 ; Saiu 1000 + 500,50 + 200 = 1700,50 ; Resultado 3299,50
  r = await pdf(page, 'exportarPDFAnual');
  eq([r.erro, r.saves], [null, ['relatorio-anual-2026.pdf']], 'gera o arquivo anual sem erro');
  ok(tem(r, 'Resultado de 2026') && tem(r, R(3299.5)) && tem(r, R(5000)) && tem(r, R(1700.5)), 'resultado 3.299,50 · entrou 5.000 · saiu 1.700,50 (2025 e transferências fora)');
  ok(tem(r, 'jan/2026') && tem(r, 'mar/2026') && !tem(r, 'dez/2025') && !tem(r, 'abr/2026'), 'resumo por mês lista os meses de 2026 que têm lançamento (jan, fev, mar); 2025 e meses sem lançamento ficam de fora');
  const iFev = S(r).indexOf('fev/2026');
  eq(S(r).slice(iFev + 1, iFev + 4), [R(0), R(0), R(0)], 'fev/2026 só tinha uma transferência: aparece como linha zerada (R$ 0,00 · R$ 0,00 · R$ 0,00) — caracterização');
  ok(tem(r, '- ' + R(1000)) && tem(r, '- ' + R(700.5)), 'gastos por categoria: Moradia 1.000,00 e Lazer 700,50 (500,50 + 200)');
  await page.evaluate(() => { document.getElementById('anoRelatorio').value = '2025'; });
  r = await pdf(page, 'exportarPDFAnual');
  ok(r.erro === null && tem(r, 'Resultado de 2025') && tem(r, R(1111)), 'ano 2025: gera e o resultado é 9.999 − 8.888 = 1.111');
  await poe(page, { tx: [] });
  r = await pdf(page, 'exportarPDFAnual');
  ok(r.erro === null && r.saves.length === 1, 'ano sem nenhum lançamento: gera sem erro');

  // ================= 4. PDF de IR =================
  console.log('4. exportarPDFIR');
  const IRTX = [
    T(1, { conta: 'Banco', valor: 200, data: '2026-08-10', categoria: 'Saúde' }), REC(2, { conta: 'Banco', valor: 500, data: '2026-06-10', desc: 'Freela A' }),
    REC(3, { conta: 'Banco', valor: 300, data: '2026-07-10', desc: 'Freela A' }), T(4, { conta: 'Banco', valor: 300, data: '2026-11-10', status: 'pendente', categoria: 'Educação' }),
    T(5, { conta: 'Nova', valor: 10, data: '2026-02-01' }),
  ];
  await poe(page, { tx: IRTX, contas: ['Banco', 'Nova', 'SemSaldo', 'Outros'], saldos: { Banco: { valor: 1000, em: '2026-01-01' }, Nova: { valor: 50, em: '2027-03-01' } } });
  await page.evaluate(() => { document.getElementById('anoRelatorio').value = '2026'; });
  r = await pdf(page, 'exportarPDFIR');
  eq([r.erro, r.saves], [null, ['relatorio-ir-2026.pdf']], 'gera "relatorio-ir-2026.pdf" sem erro');
  ok(tem(r, 'Apoio para declaração de IR') && S(r).some(s => /Não é um documento fiscal oficial/.test(s) && /contador/.test(s)), 'cabeçalho "Apoio para declaração de IR" e aviso legal em destaque');
  ok(tem(r, 'Saldo em cada conta em 31/12/2026'), 'seção "Saldo em cada conta em 31/12/2026"');
  // Banco: 1000 + 500 + 300 − 200 = 1600 (pendente de 300 não conta)
  ok(tem(r, 'Banco') && tem(r, R(1600)), 'Banco = 1.000 + 500 + 300 − 200 = R$ 1.600,00 (pendente fora)');
  ok(tem(r, 'você só passou a usar esta conta depois de 31/12/2026'), 'conta com saldo ancorado em 2027: nota "só passou a usar esta conta depois de 31/12/2026" (sem valor)');
  ok(tem(r, 'informe o saldo inicial em Contas para incluir aqui'), 'conta sem saldo inicial: nota "informe o saldo inicial em Contas…"');
  ok(tem(r, 'Total nas contas com saldo informado') && tem(r, R(1600)), 'total só das contas com saldo (R$ 1.600,00)');
  ok(tem(r, 'Gastos por categoria em 2026') && tem(r, '- ' + R(200)) && tem(r, '- ' + R(300)), 'gastos por categoria (Saúde 200 e Educação 300 — o IR inclui o pendente do ano)');
  ok(tem(r, 'Entradas que podem ser rendimento em 2026') && tem(r, 'Freela A') && tem(r, '+ ' + R(800)), 'entradas agrupadas por descrição: Freela A = 500 + 300 = 800');
  ok(tem(r, 'Pagina 1 de 1') || tem(r, 'Página 1 de 1'), 'rodapé de página presente');
  // ano sem receita
  await poe(page, { tx: [T(1, { conta: 'Banco', valor: 200, data: '2026-08-10' })], contas: ['Banco', 'Outros'], saldos: { Banco: { valor: 10, em: '2026-01-01' } } });
  await page.evaluate(() => { document.getElementById('anoRelatorio').value = '2026'; });
  r = await pdf(page, 'exportarPDFIR');
  ok(r.erro === null && !S(r).some(s => /Entradas que podem ser rendimento/.test(s)), 'ano sem receita: a seção "Entradas que podem ser rendimento" NÃO aparece');
  ok(r.erro === null && tem(r, R(190).replace('R$ ', '- R$ ').replace('190', '190')) || S(r).some(s => /- R\$ 190,00/.test(s)), 'saldo negativo é impresso com "- R$ 190,00" (10 − 200)');
  await poe(page, { tx: [], contas: ['Outros'], saldos: {} });
  r = await pdf(page, 'exportarPDFIR');
  ok(r.erro === null && tem(r, 'Nenhum gasto lançado neste ano.'), 'sem nada: gera e diz "Nenhum gasto lançado neste ano."');

  eq(page.__erros, [], 'nenhum erro de console/página');
  await browser.close();
  const t = res(); console.log(`\n${t.pass} ok, ${t.fail} fail`); process.exit(t.fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
