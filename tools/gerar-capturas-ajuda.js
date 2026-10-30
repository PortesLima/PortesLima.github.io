// Gera as capturas de tela da ajuda (ajuda/img/*.webp) com DADOS FICTÍCIOS.
// Uso: node tools/gerar-capturas-ajuda.js   (rodar de novo sempre que o app mudar de aparência)
// Requer playwright-core + Edge (mesmo ambiente de tests/lib.js). Nada sai para a rede (PostHog bloqueado).
// 390 px de largura, tema escuro, relógio fixo em 10/09/2026 12:00 BRT, WebP <= 60 KB cada.
const fs = require('fs');
const path = require('path');
const { chromium, abrir } = require('../tests/lib.js');

const SAIDA = path.resolve(__dirname, '..', 'ajuda', 'img');
const LIMITE = 60 * 1024;

const L = (id, o) => ({ tipo: 'gasto', status: 'pago', conta: 'Nubank', categoria: 'Outros', ...o, id });
// estado fictício: valores redondos, nomes genéricos
const ESTADO = {
  versao: 1,
  contas: ['Nubank', 'Carteira', 'Cartão Roxo', 'Outros'],
  contasDetalhes: { 'Cartão Roxo': { tipo: 'cartao', diaFechamento: 20, diaVencimento: 28 } },
  saldosIniciais: {
    Nubank: { valor: 2000, em: '2026-08-31' },
    Carteira: { valor: 300, em: '2026-08-31' },
    'Cartão Roxo': { valor: 0, em: '2026-08-31' },
  },
  transacoes: [
    L(1, { tipo: 'receita', desc: 'Salário', valor: 3500, data: '2026-09-05', categoria: 'Receita' }),
    L(2, { desc: 'Aluguel', valor: 1200, data: '2026-09-05', categoria: 'Moradia', fixo: true }),
    L(3, { desc: 'Mercado', valor: 450, data: '2026-09-08', categoria: 'Alimentação' }),
    L(4, { desc: 'Uber', valor: 60, data: '2026-09-03', categoria: 'Transporte', conta: 'Carteira' }),
    L(5, { desc: 'iFood', valor: 80, data: '2026-09-06', categoria: 'Alimentação' }),
    L(6, { desc: 'Cinema', valor: 70, data: '2026-09-07', categoria: 'Lazer', conta: 'Cartão Roxo' }),
    L(7, { desc: 'Farmácia', valor: 90, data: '2026-09-08', categoria: 'Saúde' }),
    L(8, { desc: 'Internet', valor: 100, data: '2026-09-12', categoria: 'Moradia', status: 'pendente', fixo: true }),
    L(9, { desc: 'Energia', valor: 150, data: '2026-09-09', categoria: 'Moradia', status: 'pendente', fixo: true }),
    L(10, { desc: 'Celular (parcela 1/3)', valor: 200, data: '2026-09-04', categoria: 'Outros', conta: 'Cartão Roxo', grupoParcela: 900 }),
    L(11, { desc: 'Celular (parcela 2/3)', valor: 200, data: '2026-10-04', categoria: 'Outros', conta: 'Cartão Roxo', grupoParcela: 900, status: 'pendente' }),
    L(12, { tipo: 'receita', desc: 'Salário', valor: 3500, data: '2026-08-05', categoria: 'Receita' }),
    L(13, { desc: 'Aluguel', valor: 1200, data: '2026-08-05', categoria: 'Moradia' }),
    L(14, { desc: 'Mercado', valor: 500, data: '2026-08-10', categoria: 'Alimentação' }),
    L(15, { desc: 'Academia', valor: 120, data: '2026-09-01', categoria: 'Saúde' }),
  ],
  orcamentos: { Alimentação: 600, Lazer: 150, Transporte: 200, Saúde: 100 },
  metas: [{ id: 501, nome: 'Viagem', valorAlvo: 3000, valorAtual: 900, prazo: '2027-06-30' }],
  recorrentes: [{ id: 601, tipo: 'gasto', desc: 'Aluguel', valor: 1200, categoria: 'Moradia' }, { id: 602, tipo: 'gasto', desc: 'Internet', valor: 100, categoria: 'Moradia' }],
};

// extrato OFX fictício com 1 duplicata provável (Mercado, 1 dia de diferença, mesmo valor)
const OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260909<TRNAMT>-450.00<FITID>A1<MEMO>Mercado</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260909<TRNAMT>-35.00<FITID>A2<MEMO>Padaria</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260910<TRNAMT>-120.00<FITID>A3<MEMO>Posto de gasolina</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260910<TRNAMT>200.00<FITID>A4<MEMO>Reembolso</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

async function webp(page, png){
  // converte PNG -> WebP com o canvas do próprio navegador, baixando a qualidade até caber em 60 KB
  const b64 = png.toString('base64');
  for(const q of [0.82, 0.72, 0.62, 0.52, 0.42]){
    const out = await page.evaluate(async ([b64, q]) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/webp', q).split(',')[1];
    }, [b64, q]);
    const buf = Buffer.from(out, 'base64');
    if(buf.length <= LIMITE) return { buf, w: 0 };
  }
  throw new Error('captura acima de 60 KB mesmo na qualidade mínima');
}

(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge' });
  const { page } = await abrir(browser, { fixed: '2026-09-10T12:00:00-03:00', vp: { width: 390, height: 844 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async e => { await aplicarDadosImportados(e); mudarAbaPrincipal('geral'); render(); }, ESTADO);
  await page.waitForTimeout(400);

  const total = [];
  async function tirar(nome, { alvo, tela = false } = {}){
    await page.waitForTimeout(350);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    const png = alvo ? await page.locator(alvo).first().screenshot() : await page.screenshot({ fullPage: false });
    const { buf } = await webp(page, png);
    fs.writeFileSync(path.join(SAIDA, nome + '.webp'), buf);
    const dim = await page.evaluate(b64 => new Promise(r => { const i = new Image(); i.onload = () => r([i.width, i.height]); i.src = 'data:image/png;base64,' + b64; }), png.toString('base64'));
    total.push({ nome, bytes: buf.length, w: dim[0], h: dim[1] });
  }
  const fechar = () => page.evaluate(() => document.querySelectorAll('.modal-bg').forEach(m => m.style.display = 'none'));

  await tirar('visao-geral');                                             // Resumo
  await tirar('fim-do-mes', { alvo: '#livreCard' });
  await page.evaluate(() => mudarAbaPrincipal('lancamentos'));
  await tirar('novo-lancamento', { alvo: '#secLancamentos .card.editable-only' });
  await page.evaluate(() => { window.scrollTo(0, 420); });
  await tirar('lista-lancamentos');
  await page.evaluate(() => { window.scrollTo(0, 0); mudarAbaPrincipal('orcamento'); });
  await tirar('orcamento');
  await page.evaluate(() => mudarAbaPrincipal('metas'));
  await tirar('metas-e-fixos');
  await page.evaluate(() => { window.scrollTo(0, 0); abrirModalRapido(); });
  await page.fill('#rapValor', '45'); await page.fill('#rapDesc', 'Uber');
  await tirar('registro-rapido');
  await fechar();
  await page.evaluate(() => { mudarAbaPrincipal('geral'); abrirModalContas(); });
  await tirar('contas-e-cartoes');
  // importar extrato: usa o input de arquivo da conta Nubank
  await page.setInputFiles('#listaContas .btn-importar-extrato input[type=file]', { name: 'extrato.ofx', mimeType: 'text/plain', buffer: Buffer.from(OFX) });
  await page.waitForSelector('#modalImportar', { state: 'visible' });
  await tirar('importar-extrato');
  await fechar();
  await page.evaluate(() => abrirModalCategorias());
  await tirar('categorias');
  await fechar();
  await page.evaluate(() => abrirModalAvisos());
  await tirar('avisos-de-vencimento');
  await fechar();
  await page.evaluate(() => { mudarAbaPrincipal('geral'); toggleMenuConfig(); });
  await tirar('menu-configuracoes');

  console.table(total);
  const soma = total.reduce((s, x) => s + x.bytes, 0);
  console.log('total', Math.round(soma / 1024) + ' KB em ' + total.length + ' imagens');
  fs.writeFileSync(path.join(SAIDA, 'dimensoes.json'), JSON.stringify(Object.fromEntries(total.map(x => [x.nome, [x.w, x.h]])), null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
