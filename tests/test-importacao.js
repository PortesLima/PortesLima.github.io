// Importação de extrato (OFX/CSV) — parsers, conciliação, fluxo completo, undo, trial bloqueado,
// ida-e-volta com exportarCSV. Caracteriza o comportamento ATUAL; o que parecer bug leva o
// prefixo [BUG-CONHECIDO] no nome do check (afirma o resultado de hoje, não o desejado).
// Relógio fixo 10/09/2026 12:00 BRT; arquivos são strings dentro do teste (File via evaluate).
const { chromium, ok, abrir, res } = require('./lib');
const FIX = '2026-09-10T12:00:00-03:00';
const eq = (a, b, n) => { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, A === B ? n : `${n}  [obtido ${A} | esperado ${B}]`); };

// ---------- fixtures ----------
const ofxSGML = (blocos) => `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n${blocos.join('\n')}\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
const trn = (o) => '<STMTTRN>' + (o.type ? `<TRNTYPE>${o.type}` : '') + (o.dt !== undefined ? `<DTPOSTED>${o.dt}` : '') +
  (o.amt !== undefined ? `<TRNAMT>${o.amt}` : '') + (o.fitid !== undefined ? `<FITID>${o.fitid}` : '') +
  (o.name !== undefined ? `<NAME>${o.name}` : '') + (o.memo !== undefined ? `<MEMO>${o.memo}` : '');
const ofxXML = `<?xml version="1.0"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260905</DTPOSTED><TRNAMT>-10.00</TRNAMT><FITID>X1</FITID><NAME>Padaria</NAME></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260906</DTPOSTED><TRNAMT>200.00</TRNAMT><FITID>X2</FITID><MEMO>Pix recebido</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
const nome40 = 'A'.repeat(40), memo41 = 'B'.repeat(41);

const T = (id, o = {}) => ({ id, tipo: 'gasto', desc: 'Mercado Central', valor: 45.9, categoria: 'Alimentação', conta: 'Nubank', data: '2026-09-05', status: 'pago', fitid: null, ...o });
const setTx = (page, arr) => page.evaluate(async a => { transacoes = a; snapshotAnterior = null; await salvarTx(); render(); }, arr);
const parse = (page, fn, txt) => page.evaluate(([f, t]) => window[f](t), [fn, txt]);
const conciliar = (page, novas, conta) => page.evaluate(([n, c]) => conciliarImportacao(n, c).map(r => ({ s: r.status, dup: r.existente ? (r.existente._doArquivo ? 'arquivo' : 'app') : null })), [novas, conta]);
// envia um "arquivo" (string ou bytes latin1) para iniciarImportacao
const enviar = (page, conta, nome, conteudo, latin1 = false) => page.evaluate(async ([c, n, s, l]) => {
  const dados = l ? Uint8Array.from(s, ch => ch.charCodeAt(0)) : s;
  await iniciarImportacao(c, new File([dados], n));
  const p = importacaoPendente;
  return p && { formato: p.formato, jaImportados: p.jaImportados, itens: p.itens.map(i => ({ st: i.status, marc: i.marcado, cat: i.categoria, desc: i.nova.desc, valor: i.nova.valor, data: i.nova.data })) };
}, [conta, nome, conteudo, latin1]);

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const { page } = await abrir(browser, { fixed: FIX });
  const dialogos = [];
  page.on('dialog', d => { dialogos.push(d.message()); d.accept(); });
  await page.evaluate(() => { if(!contas.includes('Nubank')) contas.push('Nubank'); if(!contas.includes('Itaú')) contas.push('Itaú'); });

  // ================= parseOFX =================
  console.log('1. parseOFX');
  let r = await parse(page, 'parseOFX', ofxSGML([
    trn({ type: 'DEBIT', dt: '20260905120000[-3:BRT]', amt: '-45.90', fitid: 'A1', name: 'MERCADO X', memo: 'COMPRA CARTAO' }),
    trn({ type: 'CREDIT', dt: '20260906', amt: '1500.00', fitid: 'A2', name: 'SALARIO' }),
    trn({ type: 'DEBIT', dt: '20260907', amt: '-1.234,56', fitid: 'A3', name: 'ALUGUEL' }),
  ]));
  eq(r.transacoes.length, 3, 'SGML (tags sem fechar): 3 lançamentos lidos');
  eq(r.transacoes[0], { data: '2026-09-05', desc: 'MERCADO X · COMPRA CARTAO', valor: -45.9, fitid: 'A1' }, 'SGML: DTPOSTED com hora+fuso → só a data; NAME · MEMO; valor negativo');
  eq(r.transacoes[1].valor, 1500, 'TRNAMT positivo');
  eq(r.transacoes[2].valor, -1234.56, 'TRNAMT com vírgula e milhar (-1.234,56)');
  r = await parse(page, 'parseOFX', ofxXML);
  eq(r.transacoes.map(t => [t.data, t.desc, t.valor, t.fitid]), [['2026-09-05', 'Padaria', -10, 'X1'], ['2026-09-06', 'Pix recebido', 200, 'X2']], 'XML (tags fechadas): 2 lançamentos, MEMO quando não há NAME');
  r = await parse(page, 'parseOFX', 'isto não é um extrato');
  eq(r, { transacoes: [], erro: 'formato-nao-reconhecido' }, 'sem STMTTRN e sem <OFX> → erro formato-nao-reconhecido');
  r = await parse(page, 'parseOFX', '<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>');
  eq(r, { transacoes: [] }, 'com <OFX> mas sem STMTTRN → vazio SEM erro');
  r = await parse(page, 'parseOFX', '');
  eq(r.erro, 'formato-nao-reconhecido', 'texto vazio → erro');
  const desc = async (b) => (await parse(page, 'parseOFX', ofxSGML([trn({ dt: '20260905', amt: '-1.00', ...b })]))).transacoes[0].desc;
  eq(await desc({ name: 'Uber', memo: 'UBER' }), 'Uber', 'NAME = MEMO (caixa diferente) → só uma vez');
  eq(await desc({ name: 'Uber', memo: 'Viagem 123' }), 'Uber · Viagem 123', 'NAME ≠ MEMO → "NAME · MEMO"');
  eq(await desc({ name: nome40, memo: memo41 }), nome40, 'NAME+MEMO > 80 chars → só NAME');
  eq(await desc({ name: nome40, memo: 'B'.repeat(39) }), `${nome40} · ${'B'.repeat(39)}`, 'NAME+" "+MEMO = 80 chars exatos → junta (limite inclusivo)');
  eq(await desc({ memo: 'só memo' }), 'só memo', 'só MEMO');
  eq(await desc({ name: 'só name' }), 'só name', 'só NAME');
  eq(await desc({}), 'Lançamento importado', 'sem NAME nem MEMO → "Lançamento importado"');
  r = await parse(page, 'parseOFX', ofxSGML([trn({ dt: '20260905', amt: '-3.00', name: 'sem fitid' })]));
  eq(r.transacoes[0].fitid, null, 'FITID ausente → null');
  r = await parse(page, 'parseOFX', ofxSGML([
    trn({ amt: '-5.00', name: 'sem data', fitid: 'B1' }),
    trn({ dt: '20260905', amt: 'abc', name: 'valor ruim', fitid: 'B2' }),
    trn({ dt: '20260908', amt: '-9.99', name: 'boa', fitid: 'B3' }),
  ]));
  eq(r.transacoes.map(t => t.fitid), ['B3'], 'bloco sem data / com valor inválido é pulado; o bom segue');
  r = await parse(page, 'parseOFX', ofxSGML([trn({ dt: '20260905', amt: '-3.00', name: 'Loja   com\tespaços' })]));
  eq(r.transacoes[0].desc, 'Loja com espaços', 'espaços/tabs colapsados na descrição');

  // ================= parseValorBR =================
  console.log('2. parseValorBR');
  const pv = (s) => page.evaluate(v => { const n = parseValorBR(v); return Number.isNaN(n) ? 'NaN' : n; }, s);
  for (const [e, v] of [['5970', 5970], ['5970.50', 5970.5], ['5.970,00', 5970], ['R$ 5.970,00', 5970], ['5 970,00', 5970], ['15.000', 15000],
    ['', 'NaN'], ['abc', 'NaN'], ['-12,50', -12.5], ['1.234.567', 1234567], ['R$ -1.000,00', -1000], ['47,90', 47.9], ['1.5', 1.5]]) eq(await pv(e), v, `parseValorBR(${JSON.stringify(e)}) = ${v}`);
  eq(await pv('-12.500'), -12500, 'parseValorBR("-12.500") = -12500 — INTENCIONAL na digitação: ponto + 3 dígitos é MILHAR ("12.500" = doze mil e quinhentos); o parseOFX não usa mais essa função para TRNAMT');
  eq(await pv('0.500'), 500, 'parseValorBR("0.500") = 500 — mesma regra de milhar, intencional na digitação (o OFX usa parser próprio)');
  r = await parse(page, 'parseOFX', ofxSGML([trn({ dt: '20260905', amt: '-12.500', name: 'tres casas' })]));
  eq(r.transacoes[0].valor, -12.5, 'OFX com TRNAMT "-12.500" importa como -12,5 (parser próprio do TRNAMT: só ponto = decimal)');
  // ---- parser próprio do TRNAMT: só ponto = decimal; só vírgula = decimal; os dois = o ÚLTIMO separador é o decimal
  const trnamt = async (amt) => (await parse(page, 'parseOFX', ofxSGML([trn({ dt: '20260905', amt, name: 'x', fitid: 'T' + amt })]))).transacoes.map(t => t.valor);
  for(const [raw, esperado] of [['-45.90', -45.9], ['0.5', 0.5], ['.5', 0.5], ['12.500', 12.5], ['-0.001', -0.001], ['-12.500', -12.5], ['1.234,56', 1234.56], ['-1.234,56', -1234.56], ['1,234.56', 1234.56], ['1.234.567,89', 1234567.89],
    ['-1234,56', -1234.56], ['12,5', 12.5], ['5970', 5970], ['+7.25', 7.25], ['R$ 12,50', 12.5], ['-R$ 1.000,00', -1000], ['5.', 5], ['1500.00', 1500]]){
    eq(await trnamt(raw), [esperado], `TRNAMT ${JSON.stringify(raw)} → ${esperado}`);
  }
  for(const raw of ['1.2.3', '1,2,3', '--5', '12abc', '1.234,56,7', 'R$', '-', '1e5', '0x10']){
    eq(await trnamt(raw), [], `TRNAMT inválido ${JSON.stringify(raw)}: a transação é REJEITADA (antes o parseFloat aceitava lixo no fim)`);
  }
  r = await parse(page, 'parseOFX', ofxSGML([trn({ dt: '20260905', amt: '-12.500', name: 'a', fitid: 'A' }), trn({ dt: '20260906', amt: 'xx', name: 'b', fitid: 'B' }), trn({ dt: '20260907', amt: '3,50', name: 'c', fitid: 'C' })]));
  eq(r.transacoes.map(t => [t.fitid, t.valor]), [['A', -12.5], ['C', 3.5]], 'um TRNAMT inválido derruba só a própria transação; as outras seguem');

  // ================= parseCSVBolsoCerto =================
  console.log('3. parseCSVBolsoCerto');
  const cab = '"Data";"Tipo";"Descrição";"Categoria";"Conta";"Status";"Valor";"Fixo";"Tag"';
  const lin = (d, t, desc, v) => `"${d}";"${t}";"${desc}";"Outros";"Nubank";"pago";"${v}";"não";""`;
  r = await parse(page, 'parseCSVBolsoCerto', '﻿' + [cab, lin('2026-09-05', 'gasto', 'Padaria', '12,50'), lin('2026-09-06', 'receita', 'Salário', '5.000,00'),
    lin('2026-09-07', 'transferencia', 'Pix amigo', '30,00')].join('\n'));
  eq(r.transacoes.map(t => [t.data, t.desc, t.valor]), [['2026-09-05', 'Padaria', -12.5], ['2026-09-06', 'Salário', 5000], ['2026-09-07', 'Pix amigo', -30]], 'BOM + tipo: gasto/transferência → negativo, receita → positivo');
  eq(r.transacoes[0].fitid, null, 'CSV não tem fitid');
  r = await parse(page, 'parseCSVBolsoCerto', cab + '\r\n"2026-09-05";"gasto";"Bar; ""Zé"" e cia";"Outros";"Nubank";"pago";"7,00";"não";""');
  eq(r.transacoes.map(t => t.desc), ['Bar; "Zé" e cia'], 'aspas com ";" e "" dentro (CRLF)');
  r = await parse(page, 'parseCSVBolsoCerto', 'Data;Descrição;Valor\n2026-09-05;Compra;-50,00\n2026-09-06;Depósito;100,00');
  eq(r.transacoes.map(t => t.valor), [-50, 100], 'sem coluna Tipo: mantém o sinal do Valor');
  r = await parse(page, 'parseCSVBolsoCerto', cab + '\n' + [lin('05/09/2026', 'gasto', 'data br', '1,00'), lin('2026-09-05', 'gasto', 'valor ruim', 'xx'), lin('2026-09-08', 'gasto', 'boa', '2,00')].join('\n'));
  eq(r.transacoes.map(t => t.desc), ['boa'], 'linhas com data fora de YYYY-MM-DD ou valor NaN são descartadas');
  eq((await parse(page, 'parseCSVBolsoCerto', cab)).erro, 'csv-vazio', 'só cabeçalho → csv-vazio');
  eq((await parse(page, 'parseCSVBolsoCerto', '')).erro, 'csv-vazio', 'vazio → csv-vazio');
  eq((await parse(page, 'parseCSVBolsoCerto', 'Data;Descrição\n2026-09-05;x')).erro, 'csv-formato', 'sem coluna Valor → csv-formato');
  eq((await parse(page, 'parseCSVBolsoCerto', 'Data;Descricao;Valor\n2026-09-05;x;1,00')).erro, 'csv-formato', 'cabeçalho "Descricao" sem acento → csv-formato (exige "Descrição")');
  r = await parse(page, 'parseCSVBolsoCerto', 'Data;Descrição;Valor\n2026-09-05;;3,00');
  eq(r.transacoes[0].desc, 'Lançamento importado', 'descrição vazia → "Lançamento importado"');

  // ================= conciliarImportacao =================
  console.log('4. conciliarImportacao');
  await setTx(page, [T(1, { fitid: 'F1' }), T(2, { desc: 'Padaria Pão Quente', valor: 20, data: '2026-09-10', conta: 'Nubank' })]);
  const nv = (o) => ({ data: '2026-09-05', desc: 'Mercado Central', valor: -45.9, fitid: null, ...o });
  eq((await conciliar(page, [nv({ fitid: 'F1', desc: 'qualquer coisa', valor: -1, data: '2020-01-01' })], 'Nubank'))[0].s, 'exata', 'mesmo FITID já na conta → exata (ignora data/valor/descrição)');
  eq((await conciliar(page, [nv({ fitid: 'OUTRO' })], 'Nubank'))[0].s, 'suspeita', 'FITID diferente mas igual em data/valor/desc → suspeita');
  eq((await conciliar(page, [nv({ data: '2026-09-06' })], 'Nubank'))[0], { s: 'suspeita', dup: 'app' }, 'data +1 → suspeita (existente = do app)');
  eq((await conciliar(page, [nv({ data: '2026-09-04' })], 'Nubank'))[0].s, 'suspeita', 'data −1 → suspeita');
  eq((await conciliar(page, [nv({ data: '2026-09-07' })], 'Nubank'))[0].s, 'nova', 'data +2 → nova');
  eq((await conciliar(page, [nv({ data: '2026-09-03' })], 'Nubank'))[0].s, 'nova', 'data −2 → nova');
  eq((await conciliar(page, [nv({ valor: -45.91 })], 'Nubank'))[0].s, 'nova', 'valor 1 centavo diferente → nova');
  eq((await conciliar(page, [nv({ valor: 45.9 })], 'Nubank'))[0].s, 'nova', 'tipo diferente (receita vs gasto existente) → nova');
  eq((await conciliar(page, [nv()], 'Itaú'))[0].s, 'nova', 'outra conta → nova (só compara na MESMA conta)');
  eq((await conciliar(page, [nv({ fitid: 'F1' })], 'Itaú'))[0].s, 'nova', 'mesmo FITID em OUTRA conta → nova');
  eq((await conciliar(page, [nv({ desc: 'Totalmente diferente' })], 'Nubank'))[0].s, 'nova', 'descrição sem relação → nova');
  eq((await conciliar(page, [nv({ desc: 'MERCADO CENTRAL COMPRA 123' })], 'Nubank'))[0].s, 'suspeita', 'descrição que CONTÉM a existente → suspeita');
  eq((await conciliar(page, [nv({ desc: 'mercado   central!!' })], 'Nubank'))[0].s, 'suspeita', 'pontuação/caixa/espaços normalizados');
  eq((await conciliar(page, [nv({ desc: 'Mércado Çentral' })], 'Nubank'))[0].s, 'suspeita', 'acentos ignorados ("Mércado Çentral" ≈ "Mercado Central")');
  eq((await conciliar(page, [nv({ desc: 'Padaria Pao Quente Loja', data: '2026-09-10', valor: -20 })], 'Nubank'))[0].s, 'suspeita', '≥60% dos tokens em comum (3/4 = 75%) → suspeita');
  eq((await conciliar(page, [nv({ desc: 'Padaria Pao Doce Loja', data: '2026-09-10', valor: -20 })], 'Nubank'))[0].s, 'nova', '<60% dos tokens (2/4 = 50%) → nova');
  eq(await conciliar(page, [nv({ data: '2026-08-01', valor: -9, desc: 'Cinema Centro' }), nv({ data: '2026-08-02', valor: -9, desc: 'cinema centro' })], 'Nubank'),
    [{ s: 'nova', dup: null }, { s: 'suspeita', dup: 'arquivo' }], 'duplicata DENTRO do arquivo: 1ª nova, 2ª suspeita marcada como do arquivo');
  eq((await conciliar(page, [nv({ data: '2026-08-01', valor: -9, desc: 'Cinema', fitid: 'Z' }), nv({ data: '2026-07-01', valor: -77, desc: 'Outra', fitid: 'Z' })], 'Nubank'))[1].s, 'suspeita', 'mesmo FITID repetido no arquivo → suspeita');
  eq((await conciliar(page, [nv({ data: '2026-08-01', valor: -9, desc: 'Cinema' }), nv({ data: '2026-08-01', valor: 9, desc: 'Cinema' })], 'Nubank')).map(x => x.s), ['nova', 'nova'], 'no arquivo: gasto e receita de mesmo valor NÃO são duplicata');

  // ================= fluxo: iniciarImportacao =================
  console.log('5. iniciarImportacao (fluxo)');
  await setTx(page, []);
  const arq1 = ofxSGML([
    trn({ dt: '20260903', amt: '-35.00', fitid: 'N1', name: 'IFOOD*PEDIDO' }),
    trn({ dt: '20260904', amt: '3000.00', fitid: 'N2', name: 'SALARIO EMPRESA' }),
    trn({ dt: '20260905', amt: '-80.00', fitid: 'N3', name: 'XYZ LTDA' }),
  ]);
  let f = await enviar(page, 'Nubank', 'extrato.ofx', arq1);
  eq(f.formato, 'ofx', 'formato ofx detectado');
  eq(f.itens.map(i => i.st), ['nova', 'nova', 'nova'], 'todas novas');
  eq(f.itens.map(i => i.marc), [true, true, true], 'só "nova" vem marcada');
  eq(f.itens.map(i => i.cat), ['Alimentação', 'Receita', 'Outros'], 'categoria: palpite (iFood→Alimentação), receita→"Receita", sem palpite→"Outros"');
  ok(await page.evaluate(() => document.getElementById('modalImportar').style.display === 'flex'), 'modal de pré-visualização abre');
  ok(await page.evaluate(() => document.getElementById('modalContas').style.display === 'none'), 'modal de contas fecha');
  eq(await page.evaluate(() => document.querySelectorAll('#importLista .import-item').length), 3, '3 itens renderizados');
  eq(await page.evaluate(() => document.querySelector('#importLista .import-cat select').disabled), false, 'select de categoria habilitado para gasto');
  eq(await page.evaluate(() => document.querySelectorAll('#importLista .import-cat select')[1].disabled), true, 'select de categoria travado para receita');
  await page.evaluate(() => fecharModalImportar());
  eq(await page.evaluate(() => importacaoPendente), null, 'fechar o modal zera o estado');
  eq((await page.evaluate(() => transacoes.length)), 0, 'cancelar não cria nada');

  // arquivo por conteúdo, sem extensão .ofx
  f = await enviar(page, 'Nubank', 'extrato.txt', arq1);
  eq(f.formato, 'ofx', 'sem extensão .ofx: detecta pelo conteúdo <OFX>/<STMTTRN>');
  await page.evaluate(() => fecharModalImportar());
  // CSV
  f = await enviar(page, 'Nubank', 'lancamentos.csv', cab + '\n' + lin('2026-09-05', 'gasto', 'Padaria', '12,50'));
  eq([f.formato, f.itens.length], ['csv', 1], 'CSV detectado e lido');
  await page.evaluate(() => fecharModalImportar());
  // erros → alert, sem modal
  dialogos.length = 0;
  f = await enviar(page, 'Nubank', 'lixo.ofx', 'isto não é OFX');
  eq(f, null, 'arquivo ilegível: nenhum estado pendente');
  ok(dialogos.length === 1 && /OFX/.test(dialogos[0]), 'arquivo ilegível: alerta menciona OFX');
  ok(await page.evaluate(() => document.getElementById('modalImportar').style.display !== 'flex'), 'arquivo ilegível: modal não abre');
  dialogos.length = 0;
  await enviar(page, 'Nubank', 'vazio.csv', '');
  ok(dialogos.length === 1 && /vazio/.test(dialogos[0]), 'CSV vazio: alerta "vazio"');
  dialogos.length = 0;
  await enviar(page, 'Nubank', 'x.csv', 'a;b\n1;2');
  ok(dialogos.length === 1 && /formato do Bolso Certo/.test(dialogos[0]), 'CSV de outro formato: alerta de formato');
  dialogos.length = 0;
  f = await enviar(page, 'Nubank', 'sem-movimento.ofx', '<OFX></OFX>');
  eq(f.itens.length, 0, 'OFX sem movimento: 0 itens, sem alerta');
  eq(dialogos.length, 0, 'OFX sem movimento: nenhum alerta');
  ok(/nenhum lançamento encontrado/.test(await page.evaluate(() => document.getElementById('importTopo').textContent)), 'OFX sem movimento: topo explica');
  await page.evaluate(() => fecharModalImportar());

  // windows-1252
  f = await enviar(page, 'Nubank', 'cp1252.ofx', ofxSGML([trn({ dt: '20260905', amt: '-10.00', fitid: 'W1', name: 'PADARIA SÃO JOÃO AÇAÍ' })]), true);
  eq(f.itens[0].desc, 'PADARIA SÃO JOÃO AÇAÍ', 'arquivo windows-1252 é decodificado (ã/ç/í) sem "�"');
  await page.evaluate(() => fecharModalImportar());

  // ================= confirmarImportacao =================
  console.log('6. confirmarImportacao');
  await setTx(page, []);
  await page.evaluate(() => { mesAtual = '2026-09'; });
  await enviar(page, 'Nubank', 'extrato.ofx', arq1);
  await page.evaluate(() => confirmarImportacao());
  const tx = await page.evaluate(() => transacoes.map(t => ({ ...t, id: typeof t.id })));
  eq(tx.length, 3, '3 lançamentos criados');
  const t1 = tx.find(t => t.fitid === 'N1');
  eq(t1, { id: 'number', tipo: 'gasto', desc: 'IFOOD*PEDIDO', valor: 35, categoria: 'Alimentação', conta: 'Nubank', data: '2026-09-03', fixo: false, status: 'pago', anexo: null, tag: null, fitid: 'N1', importadoEm: '2026-09-10' }, 'campos do gasto importado (valor absoluto, status pago, fitid, importadoEm = hoje)');
  const t2 = tx.find(t => t.fitid === 'N2');
  eq([t2.tipo, t2.categoria, t2.valor], ['receita', 'Receita', 3000], 'receita: tipo, categoria "Receita", valor positivo');
  eq(await page.evaluate(() => new Set(transacoes.map(t => t.id)).size), 3, 'ids únicos');
  eq(await page.evaluate(() => importacaoPendente), null, 'estado pendente zerado após confirmar');
  ok(await page.evaluate(() => document.getElementById('modalImportar').style.display === 'none'), 'modal fecha');
  const toast = await page.evaluate(() => { const el = document.getElementById('toast'); return { show: el.classList.contains('show'), txt: el.textContent, btn: !!el.querySelector('button') }; });
  ok(toast.show && /3 lançamentos importados em Nubank/.test(toast.txt) && toast.btn && /Desfazer/.test(toast.txt), 'toast "3 lançamentos importados em Nubank" com Desfazer');
  eq(await page.evaluate(() => mesAtual), '2026-09', 'vai para o mês do lançamento mais recente');
  eq(await page.evaluate(() => (JSON.parse(localStorage.getItem('bc_transacoes') || 'null') || []).length), 3, 'persistido no storage');
  // desfazer reverte tudo
  await page.evaluate(() => desfazer());
  eq(await page.evaluate(() => transacoes.length), 0, 'desfazer() remove os 3 de uma vez');
  eq(await page.evaluate(() => snapshotAnterior), null, 'snapshot consumido (1 nível, por design)');
  await page.evaluate(() => desfazer());
  eq(await page.evaluate(() => transacoes.length), 0, 'desfazer() de novo não faz nada');

  // mês mais recente
  await setTx(page, []);
  await enviar(page, 'Nubank', 'a.ofx', ofxSGML([trn({ dt: '20260715', amt: '-5.00', fitid: 'M1', name: 'a' }), trn({ dt: '20260620', amt: '-6.00', fitid: 'M2', name: 'b' })]));
  await page.evaluate(() => { mesAtual = '2026-09'; confirmarImportacao(); });
  eq(await page.evaluate(() => mesAtual), '2026-07', 'mês de destino = mês do lançamento mais recente do arquivo (jul/2026)');
  eq(await page.evaluate(() => document.getElementById('mesSel').value), '2026-07', 'seletor de mês acompanha');

  // desmarcar item
  await setTx(page, []);
  await enviar(page, 'Nubank', 'extrato.ofx', arq1);
  await page.evaluate(() => importToggle(1, false));
  eq(await page.evaluate(() => document.querySelector('#importRodape button').textContent.trim()), 'Importar 2 selecionados', 'rodapé acompanha o nº de marcados');
  await page.evaluate(() => confirmarImportacao());
  eq(await page.evaluate(() => transacoes.map(t => t.fitid).sort()), ['N1', 'N3'], 'item desmarcado não é criado');
  // trocar categoria
  await setTx(page, []);
  await enviar(page, 'Nubank', 'extrato.ofx', arq1);
  await page.evaluate(() => { importSetCat(2, 'Lazer'); confirmarImportacao(); });
  eq(await page.evaluate(() => transacoes.find(t => t.fitid === 'N3').categoria), 'Lazer', 'categoria escolhida no modal é a gravada');
  // nada marcado
  await setTx(page, []);
  await enviar(page, 'Nubank', 'extrato.ofx', arq1);
  await page.evaluate(() => { [0, 1, 2].forEach(i => importToggle(i, false)); });
  ok(await page.evaluate(() => document.querySelector('#importRodape button').disabled), 'nada marcado: botão Importar desabilitado');
  await page.evaluate(() => confirmarImportacao());
  eq(await page.evaluate(() => [transacoes.length, importacaoPendente !== null]), [0, true], 'nada marcado: confirmarImportacao() não cria e mantém o modal');
  await page.evaluate(() => fecharModalImportar());

  // ================= reimportar / suspeita / substituir =================
  console.log('7. reimportação, suspeitas e substituir');
  await setTx(page, []);
  await enviar(page, 'Nubank', 'extrato.ofx', arq1);
  await page.evaluate(() => confirmarImportacao());
  f = await enviar(page, 'Nubank', 'extrato.ofx', arq1);
  eq([f.itens.length, f.jaImportados], [0, 3], 'reimportar o MESMO arquivo: 0 itens, jaImportados = 3');
  ok(/todos os 3 lançamentos deste arquivo já estão no app/.test(await page.evaluate(() => document.getElementById('importTopo').textContent)), 'topo diz "todos os 3 … já estão no app"');
  await page.evaluate(() => fecharModalImportar());
  f = await enviar(page, 'Itaú', 'extrato.ofx', arq1);
  eq(f.itens.map(i => i.st), ['nova', 'nova', 'nova'], 'mesmo arquivo em OUTRA conta: tudo novo');
  await page.evaluate(() => fecharModalImportar());
  // arquivo com 2 já importados + 1 nova
  f = await enviar(page, 'Nubank', 'extrato2.ofx', ofxSGML([
    trn({ dt: '20260903', amt: '-35.00', fitid: 'N1', name: 'IFOOD*PEDIDO' }), trn({ dt: '20260904', amt: '3000.00', fitid: 'N2', name: 'SALARIO EMPRESA' }),
    trn({ dt: '20260909', amt: '-12.00', fitid: 'N9', name: 'CAFE NOVO' })]));
  eq([f.itens.length, f.jaImportados], [1, 2], 'parcial: só a nova aparece, jaImportados = 2');
  await page.evaluate(() => fecharModalImportar());

  // suspeita vem desmarcada; ambos / ignorar / substituir
  await setTx(page, [T(500, { desc: 'Mercado Central', valor: 45.9, data: '2026-09-05' })]);
  const arqSusp = ofxSGML([trn({ dt: '20260906', amt: '-45.90', fitid: 'S1', name: 'MERCADO CENTRAL' })]);
  f = await enviar(page, 'Nubank', 's.ofx', arqSusp);
  eq([f.itens[0].st, f.itens[0].marc], ['suspeita', false], 'suspeita vem DESMARCADA');
  ok(/possível duplicata/.test(await page.evaluate(() => document.querySelector('#importLista .import-dup').textContent)), 'aviso de possível duplicata visível');
  await page.evaluate(() => importDupAcao(0, 'ambos'));
  await page.evaluate(() => confirmarImportacao());
  eq(await page.evaluate(() => transacoes.length), 2, '"manter os dois": antigo + novo');
  await setTx(page, [T(500)]);
  await enviar(page, 'Nubank', 's.ofx', arqSusp);
  await page.evaluate(() => { importDupAcao(0, 'ambos'); importDupAcao(0, 'ignorar'); });
  eq(await page.evaluate(() => importacaoPendente.itens[0].marcado), false, '"ignorar novo" desmarca');
  await page.evaluate(() => fecharModalImportar());
  await setTx(page, [T(500), T(501, { desc: 'Outra coisa', valor: 10, data: '2026-09-01' })]);
  await enviar(page, 'Nubank', 's.ofx', arqSusp);
  await page.evaluate(() => importDupAcao(0, 'substituir'));
  eq(await page.evaluate(() => importacaoPendente.itens[0].substituir), 500, '"substituir" guarda o id do existente');
  await page.evaluate(() => confirmarImportacao());
  eq(await page.evaluate(() => transacoes.map(t => t.id === 501 ? 'outra' : t.fitid)), [ 'S1', 'outra'], '"substituir": o antigo (500) sai, o novo entra, o resto fica');
  await page.evaluate(() => desfazer());
  eq(await page.evaluate(() => transacoes.map(t => t.id).sort()), [500, 501], 'desfazer() restaura o substituído');
  // duplicata dentro do arquivo não oferece "substituir"
  await setTx(page, []);
  await enviar(page, 'Nubank', 'd.ofx', ofxSGML([trn({ dt: '20260901', amt: '-9.00', fitid: 'D1', name: 'Cinema' }), trn({ dt: '20260902', amt: '-9.00', fitid: 'D2', name: 'Cinema' })]));
  eq(await page.evaluate(() => [...document.querySelectorAll('#importLista .import-dup-acoes')[0].querySelectorAll('button')].map(b => b.textContent.trim())), ['manter os dois', 'ignorar novo'], 'duplicata do próprio arquivo: sem botão "substituir"');
  await page.evaluate(() => fecharModalImportar());

  // XSS na descrição
  await setTx(page, []);
  await enviar(page, 'Nubank', 'x.ofx', ofxSGML([trn({ dt: '20260905', amt: '-1.00', fitid: 'XS', name: '&lt;img src=x onerror=window.__xss=1&gt;' })]));
  eq(await page.evaluate(() => [!!window.__xss, document.querySelectorAll('#importLista img').length]), [false, 0], 'descrição vinda do arquivo é escapada (sem injeção de HTML)');
  await page.evaluate(() => fecharModalImportar());

  // ================= trial bloqueado =================
  console.log('8. trial bloqueado');
  await setTx(page, []);
  await page.evaluate(() => { assinatura = { status: 'trial', trialInicio: '2026-01-01', assinouEm: null }; avaliarAssinatura(); });
  eq(await page.evaluate(() => assinatura.status), 'bloqueado', 'pré-condição: trial bloqueado');
  await page.evaluate(() => { document.getElementById('modalPlanos').style.display = 'none'; });
  f = await enviar(page, 'Nubank', 'extrato.ofx', arq1);
  eq(f, null, 'bloqueado: iniciarImportacao não abre pré-visualização');
  ok(await page.evaluate(() => document.getElementById('modalPlanos').style.display === 'flex'), 'bloqueado: abre o modal de planos');
  // confirmar com pendência criada antes do bloqueio
  await page.evaluate(() => { assinatura = { status: 'ativo', trialInicio: '2026-01-01', assinouEm: '2026-09-01' }; avaliarAssinatura(); });
  await enviar(page, 'Nubank', 'extrato.ofx', arq1);
  await page.evaluate(() => { assinatura = { status: 'trial', trialInicio: '2026-01-01', assinouEm: null }; avaliarAssinatura(); document.getElementById('modalPlanos').style.display = 'none'; confirmarImportacao(); });
  eq(await page.evaluate(() => transacoes.length), 0, 'bloqueado: confirmarImportacao() não cria nada');
  ok(await page.evaluate(() => document.getElementById('modalPlanos').style.display === 'flex'), 'bloqueado: confirmar abre o modal de planos');
  await page.evaluate(() => { fecharModalImportar(); assinatura = { status: 'ativo', trialInicio: '2026-01-01', assinouEm: '2026-09-01' }; avaliarAssinatura(); document.getElementById('modalPlanos').style.display = 'none'; });

  // ================= ida e volta exportarCSV → parseCSVBolsoCerto =================
  console.log('9. exportarCSV → parseCSVBolsoCerto');
  const orig = [
    T(1, { desc: 'Almoço; "Bar do Zé" e cia', valor: 1234.5, data: '2026-08-03' }),
    T(2, { tipo: 'receita', desc: 'Salário', valor: 15000, categoria: 'Receita', data: '2026-08-05' }),
    T(3, { desc: 'Padaria', valor: 0.99, data: '2026-08-06' }),
    T(4, { desc: 'Uber', valor: 18, data: '2026-08-07', status: 'pendente' }),
  ];
  await setTx(page, orig);
  const csvBruto = await page.evaluate(async () => {
    let cap; const o = URL.createObjectURL; URL.createObjectURL = b => { cap = b; return o.call(URL, b); };
    exportarCSV(); URL.createObjectURL = o; const bytes = [...new Uint8Array(await cap.arrayBuffer()).slice(0, 3)];
    return { texto: await cap.text(), bytes };
  });
  eq(csvBruto.bytes, [0xEF, 0xBB, 0xBF], 'CSV exportado começa com BOM UTF-8 (bytes EF BB BF; Blob.text() o descarta ao decodificar)');
  const csv = csvBruto.texto;
  r = await parse(page, 'parseCSVBolsoCerto', csv);
  eq(r.transacoes.map(t => [t.data, t.desc, t.valor]), [['2026-08-03', 'Almoço; "Bar do Zé" e cia', -1234.5], ['2026-08-05', 'Salário', 15000], ['2026-08-06', 'Padaria', -0.99], ['2026-08-07', 'Uber', -18]], 'ida e volta: data/desc/valor idênticos (com ";" e aspas na descrição; receita +, gasto −)');
  // e o fluxo completo: exportado → importado numa conta vazia
  await setTx(page, []);
  f = await enviar(page, 'Nubank', 'lancamentos.csv', csv);
  eq([f.formato, f.itens.length, f.itens.every(i => i.marc)], ['csv', 4, true], 'CSV exportado importa inteiro numa conta vazia');
  await page.evaluate(() => fecharModalImportar());
  // reimportar o próprio CSV por cima dos mesmos dados: tudo suspeita (CSV não tem FITID)
  await setTx(page, orig);
  f = await enviar(page, 'Nubank', 'lancamentos.csv', csv);
  eq(f.itens.map(i => i.st), ['suspeita', 'suspeita', 'suspeita', 'suspeita'], 'reimportar o próprio CSV: 4 suspeitas (sem FITID, a conciliação é aproximada) — nada duplica sem o usuário decidir');
  eq(f.itens.map(i => i.marc), [false, false, false, false], 'e nenhuma vem marcada');
  await page.evaluate(() => fecharModalImportar());

  // ================= saúde =================
  console.log('10. saúde');
  const errosApp = page.__erros.filter(e => !/Failed to load resource|ERR_|net::/i.test(e));
  eq(errosApp, [], 'nenhum erro de página/console durante o bloco');

  await browser.close();
  const t = res(); console.log(`\n${t.pass} ok, ${t.fail} fail`); process.exit(t.fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
