// Funil de estado, backup JSON, desfazer, sync com o Drive (simulado em memória), PIN e ?readonly=1.
// Regra do projeto: todo estado novo passa por getJSON/setJSON, carregar(), montarEstado() e
// aplicarDadosImportados(). Estes testes seguram essa regra por chave. Caracteriza o comportamento
// ATUAL; o que parece errado leva [BUG-CONHECIDO] no nome do check. Relógio fixo 10/09/2026 12:00 BRT,
// PostHog bloqueado (stub quando precisa contar eventos), Drive = rota em memória, sem waitForTimeout.
const fs = require('fs'), path = require('path'), { EventEmitter } = require('events');
const { chromium, ok, abrir, bloquearPosthog, res } = require('./lib');
const FIX = '2026-09-10T12:00:00-03:00';
const APP = path.resolve(__dirname, '..', 'index.html');
const FONTE = fs.readFileSync(APP, 'utf8');
const URLAPP = require('url').pathToFileURL(APP).href + '?v=1';
const eq = (a, b, n) => { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, A === B ? n : `${n}  [obtido ${A} | esperado ${B}]`); };

// ---------- estado completo, com TODOS os campos de montarEstado() preenchidos ----------
const FULL = {
  transacoes: [
    { id: 1, tipo: 'gasto', desc: 'Mercado', valor: 45.9, categoria: 'Alimentação', conta: 'Nubank', data: '2026-09-05', status: 'pago', fitid: 'F1', importadoEm: '2026-09-06' },
    { id: 2, tipo: 'gasto', desc: 'TV (1/3)', valor: 100, categoria: 'Outros', conta: 'Nubank', data: '2026-09-20', status: 'pendente', grupoParcela: 'gp' },
    { id: 3, tipo: 'gasto', desc: 'Meta: Viagem', valor: 200, categoria: 'Outros', conta: 'Itaú', data: '2026-09-02', status: 'pago', metaId: 1, anexo: 'data:image/png;base64,AAAA', tag: 'ferias' },
  ],
  orcamentos: { Lazer: 150.5 },
  contas: ['Nubank', 'Itaú', 'Outros'],
  contasDetalhes: { Nubank: { tipo: 'cartao', diaFechamento: 25, diaVencimento: 5 } },
  metas: [{ id: 1, nome: 'Viagem', valorAlvo: 5000, valorAtual: 1200, prazo: '2027-06-01' }],
  recorrentes: [{ id: 9, tipo: 'gasto', desc: 'Aluguel', valor: 1000, categoria: 'Moradia' }],
  saldoContas: { valor: 777, em: '2026-01-01' },
  saldosIniciais: { Nubank: { valor: 1000, em: '2026-09-01' } },
  moeda: 'USD',
  tema: 'light',
  assinatura: { status: 'ativo', trialInicio: '2026-08-01', assinouEm: '2026-08-20' },
  categoriasUsuario: { adicionadas: [{ nome: 'Pets', cor: '#123456' }], renomes: { Lazer: 'Diversão' }, ocultas: ['Doação'] },
  avisosVencimento: { hoje: false, proximos: true, atrasadas: false },
};
const CHAVES_FUNIL = ['transacoes', 'orcamentos', 'contas', 'contasDetalhes', 'metas', 'recorrentes', 'saldoContas', 'saldosIniciais', 'moeda', 'tema', 'assinatura', 'categoriasUsuario', 'avisosVencimento'];
// STORAGE_* → campo de montarEstado()
const MAPA = { TX: 'transacoes', ORC: 'orcamentos', TEMA: 'tema', CONTAS: 'contas', CONTAS_DETALHES: 'contasDetalhes', METAS: 'metas', REC: 'recorrentes', SALDO_CONTAS: 'saldoContas', SALDOS_INICIAIS: 'saldosIniciais', MOEDA: 'moeda', ASSINATURA: 'assinatura', CATEGORIAS: 'categoriasUsuario', AVISOS: 'avisosVencimento' };
const LOCAL_DE_PROPOSITO = { PIN: 'pin', ONBOARDING: 'onboardingVisto', CAMBIO_CACHE: 'cambioCache' }; // nunca sincronizam

// ---------- Drive simulado em memória ----------
function criarDrive(conteudoInicial = null){
  const s = Object.assign(new EventEmitter(), { arquivo: conteudoInicial, id: 'F1', patches: [], tentativasPatch: 0, posts: 0, listas: 0, gets: 0, modo: { lista: null, media: null, patch: null, vazio: false } });
  s.aguardar = (cond, ms = 15000) => new Promise((resolve, reject) => {
    if(cond()) return resolve();
    const t = setTimeout(() => reject(new Error('timeout aguardando o Drive')), ms);
    const f = () => { if(cond()){ clearTimeout(t); s.off('req', f); resolve(); } };
    s.on('req', f);
  });
  return s;
}
async function ligarDrive(ctx, sim){
  await ctx.route(/googleapis\.com/, async route => {
    const r = route.request(), u = new URL(r.url()), cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const json = (status, obj) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(status >= 400 ? { error: { code: status, message: 'erro simulado' } } : obj) });
    if(r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    let ev = null;
    if(r.method() === 'GET' && u.pathname === '/drive/v3/files'){
      sim.listas++; ev = 'lista';
      if(sim.modo.lista) await json(sim.modo.lista, 'erro do servidor');
      else await json(200, { files: sim.arquivo !== null ? [{ id: sim.id, name: 'bolso-certo-dados.json' }] : [] });
    }else if(r.method() === 'GET' && u.pathname === '/drive/v3/files/' + sim.id){
      sim.gets++; ev = 'media';
      if(sim.modo.media) await json(sim.modo.media, 'erro do servidor');
      else if(sim.modo.vazio) await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '' });
      else await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: sim.arquivo === null ? '' : sim.arquivo });
    }else if(r.method() === 'PATCH'){
      ev = 'patch'; sim.tentativasPatch++;
      if(sim.modo.patch) await json(sim.modo.patch, 'erro do servidor');
      else { sim.arquivo = r.postData(); sim.patches.push(r.postData()); await json(200, { id: sim.id }); }
    }else if(r.method() === 'POST'){
      ev = 'post'; sim.posts++;
      const corpo = r.postData() || ''; const partes = corpo.split('Content-Type: application/json\r\n\r\n');
      sim.arquivo = (partes[partes.length - 1] || '').replace(/\r\n--bolsocerto--\s*$/, '');
      await json(200, { id: sim.id });
    }else await json(404, {});
    sim.emit('req', ev);
  });
}

// ---------- utilitários ----------
function ctl(page){
  const c = { confirm: true, prompt: null, msgs: [] };
  page.on('dialog', d => {
    c.msgs.push(d.type() + ': ' + d.message());
    if(d.type() === 'confirm') c.confirm ? d.accept() : d.dismiss();
    else if(d.type() === 'prompt') c.prompt === null ? d.dismiss() : d.accept(c.prompt);
    else d.accept();
  });
  return c;
}
const roteCambio = (page) => page.route(/frankfurter/, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ rates: { USD: 0.2, EUR: 0.18, GBP: 0.16 } }) }));
const recarregar = async (page) => { await page.reload({ waitUntil: 'load' }); await page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {}); await page.waitForFunction(() => getComputedStyle(document.getElementById('telaInicial')).display === 'none'); };
const estado = (page) => page.evaluate(() => JSON.parse(JSON.stringify(montarEstado())));
const guardado = (page, chave) => page.evaluate(k => { const v = localStorage.getItem('bc_' + k); return v === null ? undefined : JSON.parse(v); }, chave);
const arquivoDe = (obj) => typeof obj === 'string' ? obj : JSON.stringify(obj);
const importar = (page, conteudo) => page.evaluate(async c => { await importarBackupJSON(new File([c], 'backup.json')); }, conteudo);
const exportar = (page) => page.evaluate(async () => { let cap; const o = URL.createObjectURL; URL.createObjectURL = b => { cap = b; return o.call(URL, b); }; exportarBackupJSON(); URL.createObjectURL = o; return await cap.text(); });
const novoAparelho = async (browser, { fixed = FIX, drive, extra } = {}) => {
  const { ctx, page } = await abrir(browser, { fixed });
  page.__c = ctl(page);
  await roteCambio(page);
  if(drive) await ligarDrive(ctx, drive);
  return { ctx, page };
};
const semExtras = (e) => { const c = { ...e }; delete c.exportadoEm; delete c.versao; return c; };
const T = (id, o) => ({ id, tipo: 'gasto', desc: 'T' + id, valor: 10, categoria: 'Outros', conta: 'Outros', data: '2026-09-05', status: 'pago', ...o });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  // ================= 1. mapa de chaves (guard) =================
  console.log('1. mapa de chaves de armazenamento');
  const consts = [...FONTE.matchAll(/const STORAGE_(\w+) = '([^']+)';/g)].map(m => [m[1], m[2]]);
  const esperadas = Object.entries({ ...MAPA, ...LOCAL_DE_PROPOSITO }).map(([k, v]) => k + '=' + (MAPA[k] || v)).sort();
  eq(consts.map(([k, v]) => k + '=' + v).sort(), esperadas, 'GUARD: toda constante STORAGE_* está no funil (13) ou documentada como local de propósito (pin, onboardingVisto, cambioCache). Chave nova → atualize este teste e o funil');
  const literais = [...new Set([...FONTE.matchAll(/['"`](bc_[A-Za-z0-9_]+)['"`]/g)].map(m => m[1]))].sort();
  eq(literais, ['bc_aviso_venc_dispensado', 'bc_tel_expirado2'], 'GUARD: chaves bc_* escritas direto no localStorage, fora do funil, de propósito');
  ok(!/sessionStorage\.setItem\('(?!bolsoCertoVersao)/.test(FONTE), 'sessionStorage só guarda "bolsoCertoVersao" (cache-busting), nada de dado do usuário');
  const { page: p0 } = await novoAparelho(browser);
  eq(await p0.evaluate(() => Object.keys(montarEstado()).sort()), [...CHAVES_FUNIL, ].sort(), 'GUARD: montarEstado() devolve exatamente os 13 campos esperados');
  eq(await p0.evaluate(() => Object.keys(montarEstado()).filter(k => /pin|cambio|onboarding/i.test(k))), [], 'montarEstado() NÃO tem pin, cambioCache nem onboardingVisto');
  await p0.context().close();

  // ================= 2. cada chave pelo funil completo =================
  console.log('2. funil: aplicarDadosImportados → storage → recarregar → backup → segundo aparelho');
  const A = await novoAparelho(browser);
  await A.page.evaluate(async b => { await aplicarDadosImportados(b); render(); }, FULL);
  eq(semExtras(await estado(A.page)), FULL, 'A: depois de aplicarDadosImportados, montarEstado() devolve o estado inteiro (13 campos, deep-equal)');
  for(const [k, campo] of Object.entries(MAPA)){
    if(campo === 'tema') continue;
    eq(await guardado(A.page, FONTE.match(new RegExp("const STORAGE_" + k + " = '([^']+)'"))[1]), FULL[campo], `A: storage bc_${campo} gravado pelo import`);
  }
  eq(await guardado(A.page, 'tema'), 'light', 'o TEMA vindo de um backup/Drive é gravado em bc_tema (e não só aplicado na tela)');
  await recarregar(A.page);
  const depoisA = semExtras(await estado(A.page));
  for(const campo of CHAVES_FUNIL.filter(c => c !== 'tema')) eq(depoisA[campo], FULL[campo], `A: "${campo}" sobrevive a recarregar a página (carregar() lê o storage)`);
  eq(depoisA.tema, 'light', 'depois de recarregar o tema do backup continua "light"');
  // exportar → importar em um segundo aparelho de storage limpo
  await A.page.evaluate(async b => { await aplicarDadosImportados(b); }, FULL);
  const arquivo = JSON.parse(await exportar(A.page));
  eq(semExtras(arquivo), FULL, 'backup exportado carrega o estado inteiro');
  ok(typeof arquivo.exportadoEm === 'string' && !isNaN(Date.parse(arquivo.exportadoEm)), 'backup tem "exportadoEm" (ISO)');
  eq([arquivo.versao, Object.keys(arquivo)[0]], [1, 'versao'], 'o arquivo de backup traz "versao": 1 (primeiro campo)');
  const B = await novoAparelho(browser);
  eq(await B.page.evaluate(() => [transacoes.length, Object.keys(orcamentos).length, metas.length]), [0, 0, 0], 'B começa limpo');
  await importar(B.page, JSON.stringify(arquivo));
  eq(semExtras(await estado(B.page)), FULL, 'B: importarBackupJSON(arquivo do A) reproduz os 13 campos');
  ok(B.page.__c.msgs.some(m => /SUBSTITUIR/.test(m)) && B.page.__c.msgs.some(m => /sucesso/.test(m)), 'B: pede confirmação explícita ("SUBSTITUIR todos os dados") e avisa o sucesso');
  await recarregar(B.page);
  const depoisB = semExtras(await estado(B.page));
  for(const campo of CHAVES_FUNIL.filter(c => c !== 'tema')) eq(depoisB[campo], FULL[campo], `B: "${campo}" sobrevive a recarregar depois do import`);
  // as funções salvar* escrevem na chave certa
  console.log('2b. funções de salvar → chave certa');
  const C = await novoAparelho(browser);
  const via = await C.page.evaluate(async () => {
    const o = {};
    transacoes = [{ id: 1, tipo: 'gasto', desc: 'x', valor: 1, categoria: 'Outros', conta: 'Outros', data: '2026-09-01', status: 'pago' }]; await salvarTx(); o.transacoes = localStorage.getItem('bc_transacoes');
    orcamentos = { Lazer: 9 }; await salvarOrc(); o.orcamentos = localStorage.getItem('bc_orcamentos');
    metas = [{ id: 1, nome: 'm', valorAlvo: 1, valorAtual: 0 }]; await salvarMetas(); o.metas = localStorage.getItem('bc_metas');
    recorrentes = [{ id: 1, tipo: 'gasto', desc: 'r', valor: 1, categoria: 'Outros' }]; await salvarRec(); o.recorrentes = localStorage.getItem('bc_recorrentes');
    contas = ['A', 'Outros']; contasDetalhes = { A: { tipo: 'cartao', diaFechamento: 3 } }; saldosIniciais = { A: { valor: 5, em: '2026-01-01' } }; await salvarContas();
    o.contas = localStorage.getItem('bc_contas'); o.contasDetalhes = localStorage.getItem('bc_contasDetalhes'); o.saldosIniciais = localStorage.getItem('bc_saldosIniciais');
    categoriasUsuario = { adicionadas: [{ nome: 'Z', cor: '#111111' }], renomes: {}, ocultas: [] }; await salvarCategorias(); o.categoriasUsuario = localStorage.getItem('bc_categoriasUsuario');
    avisosVencimento = { hoje: false, proximos: false, atrasadas: true }; await salvarAvisos(); o.avisosVencimento = localStorage.getItem('bc_avisosVencimento');
    await alternarTema(); o.tema = localStorage.getItem('bc_tema');
    return o;
  });
  eq(Object.fromEntries(Object.entries(via).map(([k, v]) => [k, v === null ? null : JSON.parse(v)])), {
    transacoes: [{ id: 1, tipo: 'gasto', desc: 'x', valor: 1, categoria: 'Outros', conta: 'Outros', data: '2026-09-01', status: 'pago' }], orcamentos: { Lazer: 9 },
    metas: [{ id: 1, nome: 'm', valorAlvo: 1, valorAtual: 0 }], recorrentes: [{ id: 1, tipo: 'gasto', desc: 'r', valor: 1, categoria: 'Outros' }],
    contas: ['A', 'Outros'], contasDetalhes: { A: { tipo: 'cartao', diaFechamento: 3 } }, saldosIniciais: { A: { valor: 5, em: '2026-01-01' } },
    categoriasUsuario: { adicionadas: [{ nome: 'Z', cor: '#111111' }], renomes: {}, ocultas: [] }, avisosVencimento: { hoje: false, proximos: false, atrasadas: true }, tema: 'light',
  }, 'salvarTx/Orc/Metas/Rec/Contas/Categorias/Avisos e alternarTema gravam cada um na SUA chave');
  await recarregar(C.page);
  const aposC = await estado(C.page);
  eq([aposC.transacoes.length, aposC.orcamentos, aposC.contas, aposC.saldosIniciais, aposC.categoriasUsuario.adicionadas.length, aposC.avisosVencimento.atrasadas, aposC.tema], [1, { Lazer: 9 }, ['A', 'Outros'], { A: { valor: 5, em: '2026-01-01' } }, 1, true, 'light'], 'tudo isso volta depois de recarregar (inclusive o tema escolhido pelo botão)');
  // migração do saldo global legado
  const D = await novoAparelho(browser, {});
  await D.page.evaluate(async () => { await setJSON('saldoContas', { valor: 321, em: '2026-02-02' }); await setJSON('saldosIniciais', {}); });
  await recarregar(D.page);
  eq(await D.page.evaluate(() => [saldoContas, saldosIniciais[contas[0]]]), [null, { valor: 321, em: '2026-02-02' }], 'carregar() migra o saldoContas legado para o saldo inicial da 1ª conta (1 vez) e zera o campo antigo');
  for(const x of [A, B, C, D]) await x.ctx.close();

  // ================= 3. backup JSON — entradas ruins =================
  console.log('3. importarBackupJSON — entradas ruins e antigas');
  const LOCAL = { transacoes: [T(1), T(2)], orcamentos: { Lazer: 50 }, contas: ['Nubank', 'Outros'], metas: [{ id: 1, nome: 'm', valorAlvo: 10, valorAtual: 1 }], recorrentes: [{ id: 1, tipo: 'gasto', desc: 'r', valor: 1, categoria: 'Outros' }], categoriasUsuario: { adicionadas: [{ nome: 'Pets', cor: '#123456' }], renomes: {}, ocultas: [] }, avisosVencimento: { hoje: false, proximos: false, atrasadas: false }, saldosIniciais: { Nubank: { valor: 5, em: '2026-01-01' } } };
  const semear = (page) => page.evaluate(async l => { await aplicarDadosImportados(l); render(); }, LOCAL);
  const snap = (page) => page.evaluate(() => JSON.stringify(montarEstado()));
  let P = await novoAparelho(browser); await semear(P.page);
  const antes = await snap(P.page);
  P.page.__c.confirm = false;
  await importar(P.page, JSON.stringify(FULL));
  eq(await snap(P.page), antes, 'confirmação CANCELADA: nada muda');
  P.page.__c.confirm = true;
  for(const [nome, conteudo] of [['JSON inválido', '{oops'], ['arquivo vazio', ''], ['texto solto', 'isto nao e json']]){
    P.page.__c.msgs.length = 0;
    await importar(P.page, conteudo);
    eq([await snap(P.page) === antes, P.page.__c.msgs.some(m => /Não foi possível ler/.test(m))], [true, true], `${nome}: não altera nada e avisa "Não foi possível ler esse arquivo de backup."`);
  }
  // JSON válido, mas que NÃO é um backup do app
  for(const [nome, conteudo] of [['{}', '{}'], ['[]', '[]'], ['null', 'null'], ['{"foo":1}', '{"foo":1}'], ['número', '123'], ['string', '"x"'], ['true', 'true']]){
    await semear(P.page); P.page.__c.msgs.length = 0;
    const antesNB = await snap(P.page);
    await importar(P.page, conteudo);
    eq([await snap(P.page) === antesNB, P.page.__c.msgs.some(m => /não parece um backup do Bolso Certo/.test(m)), P.page.__c.msgs.some(m => /sucesso/.test(m))], [true, true, false], `arquivo JSON válido que não é um backup (${nome}): NADA muda, avisa "Esse arquivo não parece um backup do Bolso Certo" e não diz sucesso`);
  }
  // backup antigo (só 3 campos)
  await semear(P.page);
  await importar(P.page, JSON.stringify({ transacoes: [T(7)], orcamentos: { Moradia: 9 }, contas: ['Velha', 'Outros'] }));
  let e = await estado(P.page);
  eq([e.transacoes.map(t => t.id), e.orcamentos, e.contas], [[7], { Moradia: 9 }, ['Velha', 'Outros']], 'backup antigo (3 campos): lançamentos, orçamentos e contas do arquivo valem');
  eq([e.metas, e.recorrentes, e.saldosIniciais, e.contasDetalhes], [LOCAL.metas, LOCAL.recorrentes, LOCAL.saldosIniciais, {}], 'campos que o backup antigo NÃO traz (metas, fixas, saldos) ficam como estão no aparelho; só o que o arquivo traz substitui');
  eq([e.categoriasUsuario, e.avisosVencimento], [LOCAL.categoriasUsuario, LOCAL.avisosVencimento], 'backup antigo PRESERVA as categorias do usuário e as preferências de avisos do aparelho (o arquivo não trouxe esses campos)');
  eq([e.tema, e.moeda, e.assinatura.status !== undefined], ['dark', 'BRL', true], 'tema, moeda e assinatura que o arquivo não traz são preservados');
  // contas ausentes/vazias: mantém as locais
  await semear(P.page);
  await importar(P.page, JSON.stringify({ transacoes: [T(8)] }));
  eq((await estado(P.page)).contas, ['Nubank', 'Outros'], 'backup sem "contas": mantém as contas locais (manterContasSeVazio)');
  await importar(P.page, JSON.stringify({ transacoes: [T(8)], contas: [] }));
  eq((await estado(P.page)).contas, ['Nubank', 'Outros'], 'backup com contas: []: também mantém as locais');
  await importar(P.page, JSON.stringify({ transacoes: [], contas: ['Só uma'] }));
  eq((await estado(P.page)).contas, ['Só uma', 'Outros'], 'backup sem a conta "Outros": ela é acrescentada');
  // chaves extras
  await importar(P.page, JSON.stringify({ transacoes: [T(9)], extraDesconhecido: { x: 1 }, pin: '9999', accessToken: 'segredo' }));
  eq(await P.page.evaluate(() => [Object.keys(localStorage).filter(k => /extra|accessToken/i.test(k)), localStorage.getItem('bc_pin'), 'extraDesconhecido' in montarEstado()]), [[], null, false], 'chaves extras (inclusive "pin" e "accessToken") são ignoradas: nada novo no storage e o PIN não é definido por backup');
  eq((await estado(P.page)).transacoes.map(t => t.id), [9], 'e o resto do arquivo vale normalmente');
  // blob com tipos errados
  await semear(P.page); P.page.__c.msgs.length = 0;
  const antesTipos = await snap(P.page);
  await importar(P.page, JSON.stringify({ transacoes: 'abc', orcamentos: 5 }));
  eq([await snap(P.page) === antesTipos, P.page.__c.msgs.some(m => /não parece um backup/.test(m))], [true, true], 'backup com tipos errados ("transacoes": "abc"): REJEITADO, nada muda e avisa');
  eq(await P.page.evaluate(() => { try{ render(); return [Array.isArray(transacoes), typeof orcamentos]; }catch(e){ return 'quebrou'; } }), [true, 'object'], '… e o app continua renderizando com os tipos corretos');
  // validação campo a campo (arquivos que o próprio app nunca geraria)
  const ruinsH = [['contas com item não-texto', { transacoes: [], contas: ['A', 5] }], ['lançamento sem data', { transacoes: [{ id: 1, desc: 'x' }] }], ['lançamento que não é objeto', { transacoes: [5] }], ['orcamentos como array', { transacoes: [], orcamentos: [] }], ['metas como objeto', { transacoes: [], metas: {} }], ['moeda desconhecida', { transacoes: [], moeda: 'XYZ' }], ['tema desconhecido', { transacoes: [], tema: 'roxo' }], ['categoriasUsuario como texto', { transacoes: [], categoriasUsuario: 'lixo' }], ['versao como texto', { versao: 'x', transacoes: [] }], ['versao zero', { versao: 0, transacoes: [] }]];
  for(const [nome, obj] of ruinsH){ await importar(P.page, JSON.stringify(obj)); eq(await snap(P.page) === antesTipos, true, `backup inválido (${nome}): nada muda`); }
  // versão
  P.page.__c.msgs.length = 0;
  await importar(P.page, JSON.stringify({ versao: 2, transacoes: [T(1)] }));
  eq([await snap(P.page) === antesTipos, P.page.__c.msgs.some(m => /versão mais nova/.test(m))], [true, true], 'backup de uma versão MAIS NOVA que o app (versao 2): recusado com pedido para atualizar o app, nada muda');
  await importar(P.page, JSON.stringify({ versao: 1, transacoes: [T(31)] }));
  eq((await estado(P.page)).transacoes.map(t => t.id), [31], 'versao 1 explícita: aceito');
  await semear(P.page);
  await importar(P.page, JSON.stringify({ transacoes: [T(32)] }));
  eq((await estado(P.page)).transacoes.map(t => t.id), [32], 'sem campo versao: tratado como versão 1 (aceito)');
  // campo presente e vazio SUBSTITUI; campo ausente mantém
  await semear(P.page);
  await importar(P.page, JSON.stringify({ transacoes: [], metas: [], orcamentos: {}, recorrentes: [] }));
  e = await estado(P.page);
  eq([e.transacoes, e.metas, e.orcamentos, e.recorrentes], [[], [], {}, []], 'campo PRESENTE e vazio substitui (a pessoa apagou tudo)');
  eq([e.categoriasUsuario, e.avisosVencimento, e.saldosIniciais], [LOCAL.categoriasUsuario, LOCAL.avisosVencimento, LOCAL.saldosIniciais], '… enquanto os campos AUSENTES (categorias, avisos, saldos) ficam como estavam');
  // aplicarDadosImportados direto também valida (vale para o Drive) e não toca em nada
  await semear(P.page);
  const antesDir = await snap(P.page);
  eq(await P.page.evaluate(async () => { try{ await aplicarDadosImportados({ transacoes: 'abc' }); return 'aceitou'; }catch(e){ return e.codigo; } }), 'backup-invalido', 'aplicarDadosImportados({transacoes:"abc"}) lança erro "backup-invalido"');
  eq(await snap(P.page) === antesDir, true, '… sem alterar nada (memória)');
  await P.ctx.close();
  // muito grande
  console.log('3b. backup muito grande');
  P = await novoAparelho(browser); await semear(P.page);
  const grande = await P.page.evaluate(async () => {
    const n = 40000, tx = [];
    for(let i = 0; i < n; i++) tx.push({ id: i + 1000, tipo: 'gasto', desc: 'Lançamento grande número ' + i + ' ' + 'x'.repeat(150), valor: 10 + (i % 100), categoria: 'Outros', conta: 'Outros', data: '2026-09-' + String(1 + (i % 28)).padStart(2, '0'), status: 'pago' });
    const texto = JSON.stringify({ transacoes: tx, contas: ['Outros'] });
    const t0 = performance.now();
    await importarBackupJSON(new File([texto], 'grande.json'));
    const noStorage = localStorage.getItem('bc_transacoes');
    return { tamanho: texto.length, memoria: transacoes.length, noStorageTamanho: noStorage ? noStorage.length : 0, noStorageN: noStorage ? JSON.parse(noStorage).length : 0, ms: Math.round(performance.now() - t0) };
  });
  ok(grande.tamanho > 6000000, `arquivo de ${grande.tamanho.toLocaleString('pt-BR')} caracteres (40 mil lançamentos) — acima da cota do localStorage`);
  eq([grande.memoria, grande.noStorageN], [2, 2], 'backup maior que a cota do localStorage: a memória é REVERTIDA ao que estava (2 lançamentos) e o storage fica como estava');
  ok(P.page.__c.msgs.some(m => /Não coube no armazenamento do aparelho\. Nada foi alterado\./.test(m)) && !P.page.__c.msgs.some(m => /sucesso/.test(m)), 'e avisa "Não coube no armazenamento do aparelho. Nada foi alterado." (sem dizer sucesso)');
  eq(await P.page.evaluate(() => [JSON.stringify(categoriasUsuario) === localStorage.getItem('bc_categoriasUsuario'), JSON.stringify(avisosVencimento) === localStorage.getItem('bc_avisosVencimento')]), [true, true], 'e as chaves pequenas gravadas antes da falha foram desfeitas (storage consistente com a memória)');
  await P.ctx.close();

  // ================= 4. desfazer =================
  console.log('4. desfazer (1 nível)');
  P = await novoAparelho(browser);
  const pg = P.page;
  await pg.evaluate(async () => { contas = ['Nubank', 'Outros']; transacoes = [{ id: 1, tipo: 'gasto', desc: 'Base', valor: 10, categoria: 'Outros', conta: 'Nubank', data: '2026-09-05', status: 'pago' }]; snapshotAnterior = null; await salvarTx(); render(); });
  const OFX = '<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20260906<TRNAMT>-20.00<FITID>A1<NAME>Extrato A<STMTTRN><DTPOSTED>20260907<TRNAMT>-30.00<FITID>A2<NAME>Extrato B</BANKTRANLIST></OFX>';
  await pg.evaluate(async o => { await iniciarImportacao('Nubank', new File([o], 'a.ofx')); confirmarImportacao(); }, OFX);
  eq(await pg.evaluate(() => transacoes.length), 3, 'importar extrato: 2 lançamentos novos (3 no total)');
  ok(await pg.evaluate(() => !!document.querySelector('#toast.show button')), 'toast do extrato tem "Desfazer"');
  await pg.evaluate(() => desfazer());
  eq(await pg.evaluate(() => transacoes.map(t => t.id)), [1], 'desfazer() após importar extrato volta aos dados de antes (os 2 saem de uma vez)');
  await pg.evaluate(() => desfazer());
  eq(await pg.evaluate(() => transacoes.map(t => t.id)), [1], 'um 2º desfazer() não faz nada (1 nível)');
  // dois passos: extrato e depois um lançamento → desfazer só desfaz o último
  await pg.evaluate(async o => { await iniciarImportacao('Nubank', new File([o], 'a.ofx')); confirmarImportacao(); salvarSnapshot(); transacoes.unshift({ id: 50, tipo: 'gasto', desc: 'Depois', valor: 1, categoria: 'Outros', conta: 'Nubank', data: '2026-09-08', status: 'pago' }); commitTransacoes('x'); }, OFX);
  await pg.evaluate(() => desfazer());
  eq(await pg.evaluate(() => transacoes.length), 3, 'extrato + lançamento + desfazer: só o último passo é desfeito (o extrato fica)');
  // excluir parcelada
  await pg.evaluate(async () => {
    transacoes = [1, 2, 3].map(i => ({ id: 100 + i, tipo: 'gasto', desc: `TV (${i}/3)`, valor: 100, categoria: 'Outros', conta: 'Nubank', data: `2026-0${8 + i}-20`, status: 'pendente', grupoParcela: 'g' })).concat([{ id: 1, tipo: 'gasto', desc: 'Base', valor: 10, categoria: 'Outros', conta: 'Nubank', data: '2026-09-05', status: 'pago' }]);
    snapshotAnterior = null; await salvarTx(); render();
    remover(101);
  });
  ok(await pg.evaluate(() => getComputedStyle(document.getElementById('modalExcluirParcela')).display === 'flex'), 'excluir parcela abre o modal "só esta / todas"');
  await pg.evaluate(() => confirmarExclusaoParcela('todas'));
  eq(await pg.evaluate(() => transacoes.map(t => t.id)), [1], 'excluir "todas": as 3 parcelas saem');
  eq(await pg.evaluate(() => ({ botao: !!document.querySelector('#toast button'), texto: document.getElementById('toast').textContent })), { botao: false, texto: '✓3 parcelas excluídas' }, 'o toast NÃO oferece "Desfazer" (multi-item, por design)');
  eq(await pg.evaluate(() => snapshotAnterior !== null), true, 'mas o snapshot existe (desfazer() programático ainda restaura)');
  await pg.evaluate(() => desfazer());
  eq(await pg.evaluate(() => transacoes.length), 4, 'desfazer() restaura as 3 parcelas');
  // backup importado × snapshot velho
  await pg.evaluate(async () => { transacoes = [{ id: 1, tipo: 'gasto', desc: 'Base', valor: 10, categoria: 'Outros', conta: 'Nubank', data: '2026-09-05', status: 'pago' }]; snapshotAnterior = null; await salvarTx(); });
  await pg.evaluate(() => { document.getElementById('descricao').value = 'Novo'; document.getElementById('valor').value = '5'; document.getElementById('conta').value = 'Nubank'; });
  await pg.evaluate(async () => { await adicionar(); });
  ok(await pg.evaluate(() => !!document.querySelector('#toast.show button')), 'adicionar lançamento: toast com "Desfazer" (guarda o estado ANTES)');
  await importar(pg, JSON.stringify({ transacoes: [{ id: 77, tipo: 'gasto', desc: 'Do backup', valor: 1, categoria: 'Outros', conta: 'Nubank', data: '2026-09-01', status: 'pago' }], contas: ['Nubank', 'Outros'] }));
  eq(await pg.evaluate(() => transacoes.map(t => t.id)), [77], 'backup importado substitui os lançamentos');
  eq(await pg.evaluate(() => snapshotAnterior === null), true, 'importar backup ZERA o snapshot do desfazer anterior (o "Desfazer" perde a validade)');
  await pg.evaluate(() => { const b = document.querySelector('#toast.show button'); if(b) b.click(); else desfazer(); });
  eq(await pg.evaluate(() => transacoes.map(t => t.id)), [77], 'clicar no "Desfazer" do lançamento anterior DEPOIS de importar o backup NÃO troca os dados importados pelos antigos');
  await P.ctx.close();

  // ================= 5. sync com o Drive (simulado) =================
  console.log('5. Drive — last-write-wins, dois aparelhos, erros');
  const conectar = (page) => page.evaluate(async () => { accessToken = 'token-teste'; await driveSincronizarInicial(); });
  const botaoGoogle = (page) => page.evaluate(() => document.getElementById('btnGoogle').textContent.trim());
  // 5.1 primeiro uso: Drive sem arquivo → cria com o estado local
  let drive = criarDrive(null);
  let X = await novoAparelho(browser, { drive });
  await X.page.evaluate(async () => { transacoes = [{ id: 1, tipo: 'gasto', desc: 'Local X', valor: 1, categoria: 'Outros', conta: 'Outros', data: '2026-09-01', status: 'pago' }]; await salvarTx(); });
  await conectar(X.page);
  eq([drive.listas, drive.posts, JSON.parse(drive.arquivo).transacoes.map(t => t.id)], [1, 1, [1]], 'Drive sem arquivo: cria "bolsodados" (POST) com o estado local');
  eq(await botaoGoogle(X.page), '🟢 Sincronizado com Drive', 'status "Sincronizado com Drive"');
  // 5.2 debounce: várias mudanças seguidas → 1 PATCH
  const p0n = drive.patches.length;
  await X.page.evaluate(() => { for(let i = 0; i < 5; i++){ transacoes.push({ id: 10 + i, tipo: 'gasto', desc: 'm' + i, valor: 1, categoria: 'Outros', conta: 'Outros', data: '2026-09-02', status: 'pago' }); driveAgendarSync(); } });
  eq(await X.page.evaluate(() => document.getElementById('btnGoogle').textContent.trim()), '🟡 Alterações pendentes...', 'mudança local: status "Alterações pendentes"');
  await drive.aguardar(() => drive.patches.length > p0n);
  eq([drive.patches.length - p0n, JSON.parse(drive.arquivo).transacoes.length], [1, 6], '5 mudanças em sequência viram 1 PATCH (debounce) com o estado inteiro');
  // 5.3 Drive tem dados de outro aparelho → o local é SUBSTITUÍDO
  drive = criarDrive(JSON.stringify({ ...FULL, transacoes: [T(500)] }));
  X = await novoAparelho(browser, { drive });
  await X.page.evaluate(async () => { transacoes = [{ id: 1, tipo: 'gasto', desc: 'Só no local', valor: 1, categoria: 'Outros', conta: 'Outros', data: '2026-09-01', status: 'pago' }]; await salvarTx(); });
  await conectar(X.page);
  eq(await X.page.evaluate(() => transacoes.map(t => t.id)), [500], 'ao conectar, o que está no Drive SUBSTITUI o local (last-write-wins): o lançamento só-local (id 1) some');
  eq(await drive.patches.length, 0, 'e conectar NÃO sobe nada (só baixa)');
  eq(semExtras((await estado(X.page))).metas, FULL.metas, 'os outros campos também vêm do Drive');
  // 5.4 dois aparelhos
  drive = criarDrive(JSON.stringify({ ...FULL, transacoes: [T(1)] }));
  const D1 = await novoAparelho(browser, { drive }), D2 = await novoAparelho(browser, { drive });
  await conectar(D1.page); await conectar(D2.page);
  eq([await D1.page.evaluate(() => transacoes.map(t => t.id)), await D2.page.evaluate(() => transacoes.map(t => t.id))], [[1], [1]], 'dois aparelhos conectam e veem o mesmo estado');
  await D2.page.evaluate(() => { transacoes.push({ id: 2, tipo: 'gasto', desc: 'do aparelho 2', valor: 1, categoria: 'Outros', conta: 'Outros', data: '2026-09-02', status: 'pago' }); driveAgendarSync(); });
  await drive.aguardar(() => drive.patches.length >= 1);
  eq(JSON.parse(drive.arquivo).transacoes.map(t => t.id), [1, 2], 'aparelho 2 grava o lançamento 2 no Drive');
  await D1.page.evaluate(() => { transacoes.push({ id: 3, tipo: 'gasto', desc: 'do aparelho 1', valor: 1, categoria: 'Outros', conta: 'Outros', data: '2026-09-03', status: 'pago' }); driveAgendarSync(); });
  await drive.aguardar(() => drive.patches.length >= 2);
  eq(JSON.parse(drive.arquivo).transacoes.map(t => t.id), [1, 3], '[BUG-CONHECIDO] conflito: o aparelho 1 (que ainda não tinha visto o lançamento 2) grava por cima e o lançamento do aparelho 2 SOME do Drive em silêncio — não há merge (documentado como limitação; esperado: mesclar por id)');
  // reconectar o aparelho 2 baixa o estado final
  await conectar(D2.page);
  eq(await D2.page.evaluate(() => transacoes.map(t => t.id)), [1, 3], 'e ao reconectar, o aparelho 2 perde o próprio lançamento 2 também');
  for(const x of [D1, D2, X]) await x.ctx.close();
  // 5.5 erros do Drive
  console.log('5b. Drive devolvendo erro');
  const dadosNoDrive = JSON.stringify({ ...FULL });
  const msgLeitura = '🔴 Não consegui falar com o Drive — seus dados locais estão preservados';
  const barra = (page) => page.evaluate(() => { const b = document.getElementById('barraDrive'); return { visivel: !!b && getComputedStyle(b).display !== 'none', txt: b ? (b.querySelector('span') || {}).textContent : null, botao: !!(b && b.querySelector('#btnDriveRetry')) }; });
  const mutar = (page, id) => page.evaluate(i => { transacoes.push({ id: i, tipo: 'gasto', desc: 'm' + i, valor: 1, categoria: 'Outros', conta: 'Outros', data: '2026-09-02', status: 'pago' }); salvarTx(); }, id);
  const esperaBotao = (page, trecho) => page.waitForFunction(t => document.getElementById('btnGoogle').textContent.includes(t), trecho);
  // driveApi lança erro tipado em qualquer !res.ok
  drive = criarDrive(dadosNoDrive); drive.modo.lista = 500;
  X = await novoAparelho(browser, { drive });
  eq(await X.page.evaluate(async () => { accessToken = 't'; try{ await driveApi('drive/v3/files?q=x'); return null; }catch(e){ return { status: e.status, msg: e.message }; } }), { status: 500, msg: 'drive http 500' }, 'driveApi lança erro tipado (status 500) em qualquer resposta !ok');
  await X.ctx.close();
  // PATCH com erro: o status NÃO mente
  drive = criarDrive(dadosNoDrive);
  X = await novoAparelho(browser, { drive });
  await conectar(X.page);
  drive.modo.patch = 500;
  await mutar(X.page, 900);
  await drive.aguardar(() => drive.tentativasPatch >= 1);
  eq([drive.patches.length, JSON.parse(drive.arquivo).transacoes.some(t => t.id === 900)], [0, false], 'PATCH respondido com erro 500: o Drive NÃO recebeu o lançamento');
  eq(await X.page.evaluate(() => transacoes.some(t => t.id === 900)), true, 'o dado local permanece (memória)');
  await esperaBotao(X.page, 'Não sincronizou');
  eq(await botaoGoogle(X.page), '🔴 Não sincronizou', 'PATCH com 500: o botão mostra "🔴 Não sincronizou" (nunca "Sincronizado")');
  eq((await barra(X.page)).visivel && (await barra(X.page)).botao, true, 'e a faixa do Drive aparece com o botão "Tentar de novo"');
  drive.modo.patch = null;
  await X.page.click('#btnDriveRetry');
  await drive.aguardar(() => drive.patches.length >= 1);
  eq(JSON.parse(drive.arquivo).transacoes.some(t => t.id === 900), true, '"Tentar de novo" reenvia o que ficou pendente (sem precisar de nova alteração)');
  await esperaBotao(X.page, 'Sincronizado');
  eq([await botaoGoogle(X.page), (await barra(X.page)).visivel], ['🟢 Sincronizado com Drive', false], 'depois de enviar: "Sincronizado" e a faixa some');
  drive.modo.patch = 500; await mutar(X.page, 901); await drive.aguardar(() => drive.tentativasPatch >= 2);
  drive.modo.patch = null; await mutar(X.page, 902); await drive.aguardar(() => drive.patches.length >= 2);
  eq(JSON.parse(drive.arquivo).transacoes.filter(t => t.id >= 900).map(t => t.id), [900, 901, 902], 'a próxima alteração (próximo debounce) também reenvia o estado inteiro, inclusive o que falhou antes');
  await X.ctx.close();
  // leitura com falha: Drive intacto, local preservado, trava de escrita, recuperação
  const LOCAL1 = { id: 1, tipo: 'gasto', desc: 'Só no local', valor: 1, categoria: 'Outros', conta: 'Outros', data: '2026-09-01', status: 'pago' };
  const falhaLeitura = async (rotulo, ajustar) => {
    drive = criarDrive(dadosNoDrive); ajustar(drive);
    X = await novoAparelho(browser, { drive });
    await X.page.evaluate(async l => { transacoes = [l]; await salvarTx(); }, LOCAL1);
    await conectar(X.page);
    const intacto = drive.arquivo === dadosNoDrive || drive.arquivo === '{"transacoes": [corrompido';
    eq([drive.patches.length, drive.posts, intacto], [0, 0, true], rotulo + ': o Drive NÃO recebe nenhuma escrita (sem PATCH, sem arquivo novo, conteúdo intacto)');
    eq(await X.page.evaluate(() => transacoes.map(t => t.id)), [1], rotulo + ': os dados locais ficam como estavam');
    const b = await barra(X.page);
    eq([b.visivel, b.txt, b.botao], [true, msgLeitura, true], rotulo + ': faixa "Não consegui falar com o Drive — seus dados locais estão preservados" + botão "Tentar de novo"');
    ok(/🔴/.test(await botaoGoogle(X.page)), rotulo + ': o botão de status fica vermelho (não "Sincronizado")');
    // trava de escrita: sem leitura bem-sucedida nada sobe, nem por mutação nem por chamada direta
    await mutar(X.page, 77);
    eq(await X.page.evaluate(() => syncTimer), null, rotulo + ': mutação sem leitura OK não agenda sincronização');
    await X.page.evaluate(async () => { await driveSalvarAgora(); });
    eq(drive.patches.length, 0, rotulo + ': driveSalvarAgora() direto também não escreve (trava de escrita)');
    return X;
  };
  X = await falhaLeitura('leitura 500', d => { d.modo.media = 500; });
  // repetição limitada a 1 por 60 s, e também ao voltar ao primeiro plano
  const lista0 = drive.listas;
  await X.page.evaluate(async () => { await driveRetentarSeNecessario(); await driveRetentarSeNecessario(); });
  eq(drive.listas - lista0, 0, 'tentar de novo automático respeita o intervalo de 60 s (a tentativa acabou de acontecer: nenhuma nova)');
  await X.page.evaluate(() => { window.__pn0 = performance.now.bind(performance); performance.now = () => window.__pn0() + 61000; });
  await X.page.evaluate(async () => { await driveRetentarSeNecessario(); await driveRetentarSeNecessario(); });
  eq(drive.listas - lista0, 1, 'passados 60 s: UMA nova tentativa (a 2ª chamada seguida não repete)');
  const gets0 = drive.gets;
  await X.page.evaluate(() => { performance.now = () => window.__pn0() + 122000; });
  await X.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await drive.aguardar(() => drive.listas - lista0 >= 2 && drive.gets > gets0); // a tentativa chegou até a leitura (que falha)
  await X.page.evaluate(() => { performance.now = window.__pn0; }); // restaura o relógio da página
  ok(true, 'visibilitychange (voltar ao primeiro plano) dispara a nova tentativa');
  // recuperação na 2ª tentativa
  drive.modo.media = null;
  await X.page.click('#btnDriveRetry');
  await esperaBotao(X.page, 'Sincronizado');
  eq(await X.page.evaluate(() => transacoes.map(t => t.id).sort()), FULL.transacoes.map(t => t.id).sort(), 'recuperou: a leitura bem-sucedida traz o conteúdo do Drive (last-write-wins: o que só existia no aparelho é substituído — limitação documentada, sem merge)');
  eq((await barra(X.page)).visivel, false, 'recuperou: a faixa some');
  eq(drive.arquivo, dadosNoDrive, 'e o Drive continua com o conteúdo original (nada foi sobrescrito no caminho)');
  await mutar(X.page, 78); await drive.aguardar(() => drive.patches.length >= 1);
  eq(JSON.parse(drive.arquivo).transacoes.some(t => t.id === 78), true, 'depois da leitura OK as escritas voltam a funcionar');
  await X.ctx.close();
  X = await falhaLeitura('leitura 200 com corpo vazio', d => { d.modo.vazio = true; }); await X.ctx.close();
  X = await falhaLeitura('arquivo do Drive corrompido (JSON inválido)', d => { d.arquivo = '{"transacoes": [corrompido'; });
  eq(drive.arquivo, '{"transacoes": [corrompido', 'corrompido: o arquivo do Drive continua como estava (não é "reparado" às cegas)'); await X.ctx.close();
  // listagem com erro: nunca cria o 2º arquivo
  X = await falhaLeitura('listagem 500', d => { d.modo.lista = 500; });
  eq(drive.posts, 0, 'erro 500 ao LISTAR: NÃO cria outro "bolso-certo-dados.json"');
  await X.ctx.close();
  // JSON válido sem "transacoes" ({}): leitura OK, arquivo sem dados → o local sobe para inicializar, como antes
  drive = criarDrive('{}');
  X = await novoAparelho(browser, { drive });
  await X.page.evaluate(async l => { transacoes = [l]; await salvarTx(); }, LOCAL1);
  await conectar(X.page);
  await drive.aguardar(() => drive.patches.length >= 1);
  eq(JSON.parse(drive.arquivo).transacoes.map(t => t.id), [1], 'arquivo {} (leitura OK, sem dados): o local sobe para inicializar o arquivo');
  await X.ctx.close();
  // 401 sem renovação
  drive = criarDrive(dadosNoDrive); drive.modo.lista = 401;
  X = await novoAparelho(browser, { drive });
  await X.page.evaluate(() => { tokenClient = null; });
  await conectar(X.page);
  eq([await X.page.evaluate(() => accessToken), await botaoGoogle(X.page)], [null, '⚠️ Erro ao sincronizar'], '401 sem como renovar: token descartado; o botão termina em "Erro ao sincronizar" (a mensagem "Sessão expirada, clique para reconectar" é sobrescrita pelo catch)');
  await X.ctx.close();
  // sem token: nada acontece
  drive = criarDrive(dadosNoDrive);
  X = await novoAparelho(browser, { drive });
  await X.page.evaluate(async () => { await salvarTx(); driveAgendarSync(); await driveSalvarAgora(); });
  eq([drive.listas, drive.gets, drive.patches.length, drive.posts], [0, 0, 0, 0], 'sem token do Google: nenhuma chamada ao Drive');
  await X.ctx.close();

  // ================= 6. PIN =================
  console.log('6. PIN');
  P = await novoAparelho(browser);
  P.page.__c.prompt = '1234';
  const pinLoja = () => P.page.evaluate(() => { const v = localStorage.getItem('bc_pin'); return v === null ? null : JSON.parse(v); }); // removido = JSON null
  await P.page.evaluate(() => configurarPin());
  eq([await pinLoja(), P.page.__c.msgs.slice(-1)[0].startsWith('alert: PIN configurado')], ['1234', true], 'ativar: prompt "1234" grava o PIN e avisa');
  eq(await P.page.evaluate(() => localStorage.getItem('bc_pin')), '"1234"', 'o PIN fica em TEXTO PURO no localStorage (caracterização: é só trava de tela, como o CLAUDE.md diz)');
  for(const ruim of ['abc', '123', '1234567', '12 34', '']){
    await P.page.evaluate(async () => { await setJSON('pin', null); });
    P.page.__c.prompt = ruim; P.page.__c.msgs.length = 0;
    await P.page.evaluate(() => configurarPin());
    eq([await pinLoja(), /PIN inválido/.test(P.page.__c.msgs.join())], [null, true], `PIN inválido ${JSON.stringify(ruim)}: recusado com aviso`);
  }
  P.page.__c.prompt = null; P.page.__c.msgs.length = 0;
  await P.page.evaluate(() => configurarPin());
  eq(await pinLoja(), null, 'cancelar o prompt: não cria PIN');
  P.page.__c.prompt = '654321';
  await P.page.evaluate(() => configurarPin());
  eq(await pinLoja(), '654321', 'PIN de 6 dígitos aceito');
  // bloqueio ao abrir
  await recarregar(P.page).catch(() => {});
  eq(await P.page.evaluate(() => [getComputedStyle(document.getElementById('telaPin')).display, getComputedStyle(document.getElementById('conteudoApp')).display]), ['flex', 'none'], 'com PIN, abrir o app mostra a tela de PIN e esconde o conteúdo');
  await P.page.fill('#pinInput', '000000'); await P.page.click('#telaPin button');
  eq(await P.page.evaluate(() => [getComputedStyle(document.getElementById('pinErro')).display, document.getElementById('pinInput').value, getComputedStyle(document.getElementById('conteudoApp')).display]), ['block', '', 'none'], 'PIN errado: mostra o erro, limpa o campo e continua bloqueado');
  for(let i = 0; i < 12; i++){ await P.page.fill('#pinInput', '11111' + (i % 10)); await P.page.click('#telaPin button'); }
  eq(await P.page.evaluate(() => getComputedStyle(document.getElementById('conteudoApp')).display), 'none', '12 tentativas erradas seguidas: sem bloqueio temporário nem limite (caracterização)');
  await P.page.fill('#pinInput', '654321'); await P.page.click('#telaPin button');
  eq(await P.page.evaluate(() => [getComputedStyle(document.getElementById('telaPin')).display, getComputedStyle(document.getElementById('conteudoApp')).display]), ['none', 'block'], 'PIN certo: libera o app');
  // Enter no campo
  await recarregar(P.page).catch(() => {});
  await P.page.fill('#pinInput', '654321'); await P.page.press('#pinInput', 'Enter');
  eq(await P.page.evaluate(() => getComputedStyle(document.getElementById('conteudoApp')).display), 'block', 'Enter no campo também confere o PIN');
  // trocar = remover + criar
  P.page.__c.confirm = true; P.page.__c.prompt = '9999'; P.page.__c.msgs.length = 0;
  await P.page.evaluate(() => configurarPin());
  eq([await pinLoja(), P.page.__c.msgs.some(m => /PIN removido/.test(m))], [null, true], 'não há "trocar": com PIN existente, configurarPin() REMOVE (sem pedir o PIN atual) — só confirm genérico');
  await P.page.evaluate(() => configurarPin());
  eq(await pinLoja(), '9999', '… e uma 2ª chamada cria o novo (troca = remover + criar)');
  P.page.__c.confirm = false;
  await P.page.evaluate(() => configurarPin());
  eq(await pinLoja(), '9999', 'recusar o confirm de remoção mantém o PIN');
  // PIN fora do backup / Drive
  P.page.__c.confirm = true;
  const arq = await exportar(P.page);
  ok(!arq.includes('9999') && !('pin' in JSON.parse(arq)), 'backup exportado NÃO contém o PIN');
  eq(await P.page.evaluate(() => 'pin' in montarEstado()), false, 'montarEstado() (o que vai para o Drive) NÃO tem "pin"');
  await importar(P.page, JSON.stringify({ transacoes: [], pin: '0000' }));
  eq(await pinLoja(), '9999', 'importar backup não altera nem remove o PIN do aparelho');
  drive = criarDrive(JSON.stringify(FULL));
  await ligarDrive(P.ctx, drive);
  await conectar(P.page);
  await P.page.evaluate(() => { transacoes.push({ id: 5, tipo: 'gasto', desc: 'x', valor: 1, categoria: 'Outros', conta: 'Outros', data: '2026-09-02', status: 'pago' }); salvarTx(); });
  await drive.aguardar(() => drive.patches.length >= 1);
  ok(!drive.patches[0].includes('9999') && !drive.patches[0].includes('"pin"'), 'o que sobe para o Drive não contém o PIN');
  // "Esqueci o PIN"
  await recarregar(P.page).catch(() => {});
  eq(await P.page.evaluate(() => getComputedStyle(document.getElementById('telaPin')).display), 'flex', 'pré-condição: tela de PIN');
  await P.page.evaluate(() => resetarPin());
  eq([await pinLoja(), await P.page.evaluate(() => getComputedStyle(document.getElementById('conteudoApp')).display)], [null, 'block'], '[BUG-CONHECIDO] o link "Esqueci o PIN / remover proteção" na própria tela de bloqueio remove o PIN e abre o app com um único confirm, sem nenhuma verificação — qualquer pessoa com o aparelho contorna o PIN; esperado: exigir login Google (ou ao menos avisar que apaga os dados)');
  await P.ctx.close();
  // PIN + ?readonly=1
  P = await novoAparelho(browser);
  await P.page.evaluate(async () => { await setJSON('pin', '4321'); });
  await P.page.goto(URLAPP + '&readonly=1', { waitUntil: 'load' });
  await P.page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
  await P.page.waitForFunction(() => getComputedStyle(document.getElementById('telaInicial')).display === 'none');
  eq(await P.page.evaluate(() => [getComputedStyle(document.getElementById('telaPin')).display, getComputedStyle(document.getElementById('conteudoApp')).display]), ['flex', 'none'], '?readonly=1 também pede o PIN');
  await P.ctx.close();

  // ================= 7. ?readonly=1 =================
  console.log('7. link só de leitura (?readonly=1)');
  // aparelho com tudo semeado direto no storage + espião de escritas
  const abrirRO = async ({ query, drive: dr }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, timezoneId: 'America/Sao_Paulo' });
    await bloquearPosthog(ctx);
    if(dr) await ligarDrive(ctx, dr);
    const page = await ctx.newPage(); page.__erros = []; page.on('pageerror', e => page.__erros.push(e.message)); page.__c = ctl(page);
    await roteCambio(page);
    await page.clock.setFixedTime(new Date(FIX));
    const semente = Object.fromEntries(Object.entries(FULL).filter(([k]) => k !== 'moeda' && k !== 'tema').map(([k, v]) => [k, JSON.stringify(v)]));
    await page.addInitScript(`(function(){
      window.__ev = []; window.posthog = { __SV: 1, __loaded: true, init: function(){}, capture: function(n){ window.__ev.push(n); } };
      if(!localStorage.getItem('bc_semeado')){
        localStorage.setItem('bc_semeado', '1'); localStorage.setItem('bc_onboardingVisto', 'true');
        const s = ${JSON.stringify(semente)}; for(const k in s) localStorage.setItem('bc_' + k, s[k]);
        localStorage.setItem('bc_moeda', '"BRL"'); localStorage.setItem('bc_tema', '"dark"');
      }
      window.__w = []; const o = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v){ if(this === localStorage) window.__w.push(k); return o.call(this, k, v); };
    })();`);
    await page.goto(URLAPP + query, { waitUntil: 'load' });
    await page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => getComputedStyle(document.getElementById('telaInicial')).display === 'none');
    return { ctx, page };
  };
  let R = await abrirRO({ query: '&readonly=1' });
  eq(await R.page.evaluate(() => [document.body.classList.contains('readonly'), window.__ev]), [true, []], 'abre em modo só leitura e NENHUM evento de telemetria sai (nem sessao_iniciada)');
  const bootW = await R.page.evaluate(() => window.__w.filter(k => !/bc_semeado/.test(k)));
  eq(bootW, [], 'o boot do link só de leitura NÃO grava nada no storage (com tudo já semeado)');
  await R.page.evaluate(() => { for(const a of ['geral', 'lancamentos', 'orcamento', 'metas', 'geral']) mudarAbaPrincipal(a); mudarSubAbaGeral('analise'); mudarSubAbaGeral('resumo'); mesAtual = '2026-08'; render(); });
  eq(await R.page.evaluate(() => window.__w.filter(k => !/bc_semeado/.test(k))), [], 'navegar (abas, sub-abas, mês) NÃO grava nada');
  eq(await R.page.evaluate(() => { rastrear('qualquer'); return window.__ev; }), [], 'rastrear() é no-op');
  // sem semente: o primeiro acesso grava a assinatura (trial)
  const RV = await (async () => {
    const ctx = await browser.newContext({ timezoneId: 'America/Sao_Paulo' }); await bloquearPosthog(ctx);
    const page = await ctx.newPage(); await page.clock.setFixedTime(new Date(FIX));
    await page.addInitScript(`localStorage.setItem('bc_onboardingVisto','true'); window.__w = []; const o = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v){ if(this === localStorage) window.__w.push(k); return o.call(this,k,v); };`);
    await page.goto(URLAPP + '&readonly=1', { waitUntil: 'load' });
    await page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => getComputedStyle(document.getElementById('telaInicial')).display === 'none');
    return { ctx, page };
  })();
  eq(await RV.page.evaluate(() => window.__w.filter(k => k !== 'bc_onboardingVisto').sort()), ['bc_assinatura'], '[BUG-CONHECIDO] abrir o link só de leitura num aparelho SEM dados inicia o teste de 15 dias (grava bc_assinatura): quem só consulta consome o trial; esperado: nenhuma escrita em modo leitura');
  await RV.ctx.close();
  // Drive em modo leitura
  const dr1 = criarDrive(JSON.stringify({ ...FULL, transacoes: [T(500)] }));
  const R2 = await abrirRO({ query: '&readonly=1', drive: dr1 });
  await conectar(R2.page);
  eq([dr1.posts, dr1.patches.length, await R2.page.evaluate(() => transacoes.map(t => t.id))], [0, 0, [500]], 'com Drive que já tem dados: só baixa — nenhum POST/PATCH');
  await R2.ctx.close();
  const dr2 = criarDrive(null);
  const R3 = await abrirRO({ query: '&readonly=1', drive: dr2 });
  await conectar(R3.page);
  eq([dr2.posts, dr2.arquivo !== null], [1, true], '[BUG-CONHECIDO] com o Drive SEM arquivo, o link só de leitura CRIA o arquivo e sobe o estado local — é uma escrita no Drive; esperado: não escrever em modo leitura');
  await R3.ctx.close();
  // as ações de escrita continuam existindo como funções (a barreira é visual) — como no trial
  const R4 = await abrirRO({ query: '&readonly=1' });
  await R4.page.evaluate(async () => { document.getElementById('descricao').value = 'via console'; document.getElementById('valor').value = '5'; document.getElementById('conta').value = 'Nubank'; await adicionar(); });
  eq(await R4.page.evaluate(() => transacoes.some(t => t.desc === 'via console')), true, 'caracterização: adicionar() chamado pelo console grava mesmo com ?readonly=1 (a barreira é só CSS, como no soft-block do trial)');
  await R4.ctx.close();
  await R.ctx.close();

  await browser.close();
  const t = res(); console.log(`\n${t.pass} ok, ${t.fail} fail`); process.exit(t.fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
