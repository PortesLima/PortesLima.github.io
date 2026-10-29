// Categorias e orçamentos — normalização, adicionar/renomear/excluir (com vínculos em lançamentos,
// orçamentos e contas fixas), nomes hostis (HTML/aspas/emoji), limites de orçamento, "Orçamento em risco"
// nas fronteiras 79/80/100/101 % e persistência pelo funil de estado. Caracteriza o comportamento ATUAL;
// o que parece errado leva [BUG-CONHECIDO] no nome do check (afirma o resultado de hoje).
// Relógio fixo 10/09/2026 12:00 BRT, PostHog bloqueado (abrir()), sem waitForTimeout.
const { chromium, ok, abrir, res } = require('./lib');
const FIX = '2026-09-10T12:00:00-03:00';
const eq = (a, b, n) => { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, A === B ? n : `${n}  [obtido ${A} | esperado ${B}]`); };

const T = (id, categoria, valor = 10, o = {}) => ({ id, tipo: 'gasto', desc: 'Item ' + id, valor, categoria, conta: 'Outros', data: '2026-09-05', status: 'pago', ...o });
const R = (id, categoria, valor = 50) => ({ id, tipo: 'gasto', desc: 'Fixa ' + id, valor, categoria });
// põe o app num estado conhecido e persiste (mesmo caminho do funil)
const reset = (page, { tx = [], orc = {}, rec = [], cu = null } = {}) => page.evaluate(async ([tx, orc, rec, cu]) => {
  transacoes = tx; orcamentos = orc; recorrentes = rec; snapshotAnterior = null;
  categoriasUsuario = normalizarCategoriasUsuario(cu);
  await salvarTx(); await salvarOrc(); await salvarRec(); await salvarCategorias();
  document.getElementById('orcEdit').style.display = 'none';
  popularSelectsEstaticos(); render();
}, [tx, orc, rec, cu]);
const ativas = (page) => page.evaluate(() => categoriasAtivas());
const cu = (page) => page.evaluate(() => JSON.parse(JSON.stringify(categoriasUsuario)));
const opts = (page, id) => page.evaluate(i => [...document.getElementById(i).options].map(o => o.value), id);
// adicionar pela UI; devolve o erro visível (ou null)
const addCat = (page, nome) => page.evaluate(async n => {
  document.getElementById('novaCategoriaNome').value = n;
  document.getElementById('categoriaErro').style.display = 'none';
  await adicionarCategoria();
  const e = document.getElementById('categoriaErro');
  return getComputedStyle(e).display === 'none' ? null : e.textContent;
}, nome);
const chaveDe = (page, nome) => page.evaluate(n => {
  const p = CATEGORIAS_PADRAO.find(c => nomeCategoriaPadrao(c) === n);
  if(p) return 'p:' + p;
  const i = categoriasUsuario.adicionadas.findIndex(x => x.nome === n);
  return i >= 0 ? 'a:' + i : null;
}, nome);
const renomear = async (page, de, para) => { const k = await chaveDe(page, de); await page.evaluate(([k, p]) => renomearCategoria(k, p), [k, para]); };
const excluir = async (page, nome) => { const k = await chaveDe(page, nome); await page.evaluate(k => excluirCategoria(k), k); };
const mover = (page, destino) => page.evaluate(async d => { document.getElementById('categoriaMoverDestino').value = d; await confirmarMoverCategoria(); }, destino);
const moverBox = (page) => page.evaluate(() => ({ aberto: getComputedStyle(document.getElementById('categoriaMoverBox')).display !== 'none', destinos: [...document.getElementById('categoriaMoverDestino').options].map(o => o.value), padrao: document.getElementById('categoriaMoverDestino').value, txt: document.getElementById('categoriaMoverTxt').textContent }));
const lerTx = (page) => page.evaluate(() => transacoes.map(t => [t.id, t.categoria]));
const setOrc = (page, cat, val) => page.evaluate(([c, v]) => { setOrcamento(c, v); return orcamentos[c] === undefined ? null : orcamentos[c]; }, [cat, val]);
const risco = (page) => page.evaluate(() => {
  const card = document.getElementById('cardOrcamentoRisco');
  if(getComputedStyle(card).display === 'none') return null;
  return [...document.querySelectorAll('#listaOrcamentoRisco .orc-row')].map(r => ({ cat: r.querySelector('.orc-label').textContent, val: r.querySelector('.orc-val').textContent.replace(/\s+/g, ' ').trim() }));
});
const alertasOrc = (page) => page.evaluate(() => [...document.querySelectorAll('#alertas .alert')].map(a => a.textContent.replace(/\s+/g, ' ').trim()).filter(t => /Categoria .*(já usou|estourou o orçamento)/.test(t))); // só os alertas POR CATEGORIA (há também o de projeção do orçamento total)

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const { page } = await abrir(browser, { fixed: FIX });
  const dialogos = [];
  page.on('dialog', d => { dialogos.push(d.message()); d.accept(); });

  // ================= 1. normalizarCategoriasUsuario =================
  console.log('1. normalizarCategoriasUsuario');
  const norm = (v) => page.evaluate(x => normalizarCategoriasUsuario(x), v);
  const VAZIO = { adicionadas: [], renomes: {}, ocultas: [] };
  for(const [n, v] of [['null', null], ['string', 'lixo'], ['número', 5], ['array', []], ['objeto vazio', {}]]) eq(await norm(v), VAZIO, `entrada ${n} → shape vazio`);
  let nr = await norm({ adicionadas: [{ nome: 'Pets', cor: '#111111' }, { cor: '#222222' }, null, { nome: '' }, { nome: 5 }, { nome: 'SemCor' }], renomes: { Lazer: 'Diversão', Fantasma: 'X', Saúde: 'Saúde', Moradia: '', Transporte: 123 }, ocultas: ['Outros', 'Doação', 'Fantasma'] });
  eq(nr.adicionadas.map(x => x.nome), ['Pets', '5', 'SemCor'], 'adicionadas: descarta sem nome/vazio/null; nome numérico vira texto');
  eq(nr.adicionadas[0].cor, '#111111', 'mantém a cor informada');
  ok(/^#[0-9a-f]{6}$/i.test(nr.adicionadas[2].cor), 'sem cor → recebe uma da paleta');
  eq(nr.renomes, { Lazer: 'Diversão', Transporte: '123' }, 'renomes: ignora não-padrão, igual ao original e vazio');
  eq(nr.ocultas, ['Doação'], 'ocultas: nunca "Outros", ignora não-padrão');

  // ================= 2. adicionar =================
  console.log('2. adicionarCategoria');
  await reset(page);
  eq(await addCat(page, 'Pets'), null, 'adiciona "Pets"');
  eq((await ativas(page)).slice(-1), ['Pets'], 'aparece no fim de categoriasAtivas()');
  const corPets = (await cu(page)).adicionadas[0].cor;
  ok(/^#[0-9a-f]{6}$/i.test(corPets) && !Object.values(await page.evaluate(() => CORES_PADRAO)).includes(corPets), 'cor automática da paleta (diferente das padrão)');
  for(const id of ['categoria', 'recCategoria', 'filtroCategoria']) ok((await opts(page, id)).includes('Pets'), `select #${id} tem "Pets"`);
  await page.evaluate(() => abrirModalRapido());
  ok((await opts(page, 'rapCategoria')).includes('Pets'), 'select #rapCategoria tem "Pets"');
  await page.evaluate(() => { fecharModalRapido(); toggleOrcEdit(); });
  ok(await page.evaluate(() => [...document.querySelectorAll('#orcEdit .orc-edit-row label')].some(l => l.textContent === 'Pets')), 'editor de orçamento lista "Pets"');
  await page.evaluate(() => toggleOrcEdit());
  eq(await page.evaluate(() => document.getElementById('toast').textContent.includes('Pets')), true, 'toast confirma');
  eq(await page.evaluate(() => JSON.parse(localStorage.getItem('bc_categoriasUsuario')).adicionadas.map(x => x.nome)), ['Pets'], 'persistido no storage');
  const erros = [
    ['', 'Digite um nome para a categoria.', 'vazio'], ['     ', 'Digite um nome para a categoria.', 'só espaços'], ['\t\n', 'Digite um nome para a categoria.', 'só tab/enter'],
    ['x'.repeat(31), 'Nome muito longo (máx. 30 caracteres).', '31 caracteres'],
    ['Pets', 'Já existe uma categoria "Pets".', 'duplicada exata'], ['pETS', 'Já existe uma categoria "pETS".', 'duplicada em outra caixa'], ['  Pets  ', 'Já existe uma categoria "Pets".', 'duplicada com espaços nas pontas (trim)'],
    ['moradia', 'Já existe uma categoria "moradia".', 'duplicada de uma padrão'], ['Outros', 'Já existe uma categoria "Outros".', 'duplicada de "Outros"'],
    ['receita', 'Já existe uma categoria "receita".', 'reservada "Receita" (caixa diferente)'], ['TRANSFERÊNCIA', 'Já existe uma categoria "TRANSFERÊNCIA".', 'reservada "Transferência"'],
  ];
  for(const [nome, msg, d] of erros){ eq(await addCat(page, nome), msg, `${d}: bloqueia com a mensagem certa`); }
  eq((await ativas(page)).filter(c => c === 'Pets').length, 1, 'nenhuma duplicata foi criada');
  eq(await addCat(page, 'y'.repeat(30)), null, '30 caracteres exatos: aceita');
  eq(await addCat(page, 'Pet   Shop'), null, 'espaços internos repetidos são mantidos como digitados (caracterização)');
  eq(await addCat(page, 'Pet Shop'), null, '"Pet Shop" ≠ "Pet   Shop": ambas coexistem (caracterização: sem normalizar espaços internos)');
  eq(await addCat(page, 'Água'), null, '"Água" aceita'); eq(await addCat(page, 'Agua'), null, '"Agua" (sem acento) coexiste com "Água" (caracterização)');
  eq(await addCat(page, 'ÁGUA'), 'Já existe uma categoria "ÁGUA".', '"ÁGUA" ≡ "Água" em minúsculas → bloqueia');
  // categoria liberada por renome / ocultação
  await reset(page);
  await renomear(page, 'Lazer', 'Diversão');
  eq(await addCat(page, 'Lazer'), null, 'nome ORIGINAL de uma padrão renomeada fica livre');
  eq(await addCat(page, 'Diversão'), 'Já existe uma categoria "Diversão".', 'nome NOVO da renomeada está ocupado');
  await excluir(page, 'Doação');
  eq(await addCat(page, 'Doação'), null, 'nome de uma padrão OCULTA fica livre');
  eq(await page.evaluate(() => corCategoria('Doação')), (await cu(page)).adicionadas.find(x => x.nome === 'Doação').cor, 'e a cor é a da adicionada (não a padrão)');
  // cores
  await reset(page);
  for(let i = 1; i <= 13; i++) await addCat(page, 'C' + i);
  const cores = (await cu(page)).adicionadas.map(x => x.cor);
  eq(new Set(cores.slice(0, 12)).size, 12, 'as 12 primeiras cores automáticas são todas distintas');
  eq(cores[12], cores[0], 'a 13ª reaproveita a paleta (volta à 1ª cor)');

  // ================= 3. renomear =================
  console.log('3. renomearCategoria — vínculos');
  await reset(page, { tx: [T(1, 'Lazer', 30), T(2, 'Lazer', 20, { data: '2026-08-10' }), T(3, 'Moradia', 900)], orc: { Lazer: 100, Moradia: 1000 }, rec: [R(1, 'Lazer', 40), R(2, 'Moradia', 900)] });
  await page.evaluate(() => { document.getElementById('filtroCategoria').value = 'Lazer'; });
  await renomear(page, 'Lazer', 'Diversão');
  eq(await lerTx(page), [[1, 'Diversão'], [2, 'Diversão'], [3, 'Moradia']], 'lançamentos (todos os meses) seguem a categoria');
  eq(await page.evaluate(() => orcamentos), { Moradia: 1000, Diversão: 100 }, 'orçamento migra para o novo nome (limite intacto)');
  eq(await page.evaluate(() => recorrentes.map(r => r.categoria)), ['Diversão', 'Moradia'], 'contas fixas (recorrentes) seguem a categoria');
  eq((await cu(page)).renomes, { Lazer: 'Diversão' }, 'renome guardado');
  ok((await ativas(page)).includes('Diversão') && !(await ativas(page)).includes('Lazer'), 'lista ativa mostra só o novo nome');
  eq(await page.evaluate(() => corCategoria('Diversão')), await page.evaluate(() => CORES_PADRAO.Lazer), 'herda a cor da padrão');
  for(const id of ['categoria', 'recCategoria', 'filtroCategoria']) ok((await opts(page, id)).includes('Diversão') && !(await opts(page, id)).includes('Lazer'), `select #${id} reflete o renome`);
  eq(await page.evaluate(() => document.getElementById('filtroCategoria').value), '', 'filtro que estava em "Lazer" volta para "Todas categorias" (a opção sumiu)');
  eq(await page.evaluate(() => contarUsoCategoria('Diversão')), { tx: 2, orc: 1, rec: 1, total: 4 }, 'contarUsoCategoria soma lançamentos + orçamento + fixas');
  ok(await page.evaluate(() => document.getElementById('toast').textContent.includes('Diversão')), 'toast confirma o renome');
  eq(await page.evaluate(() => JSON.parse(localStorage.getItem('bc_transacoes')).map(t => t.categoria)), ['Diversão', 'Diversão', 'Moradia'], 'transações persistidas com o novo nome');
  eq(await page.evaluate(() => JSON.parse(localStorage.getItem('bc_orcamentos'))), { Moradia: 1000, Diversão: 100 }, 'orçamentos persistidos com o novo nome');
  eq(await page.evaluate(() => JSON.parse(localStorage.getItem('bc_recorrentes')).map(r => r.categoria)), ['Diversão', 'Moradia'], 'recorrentes persistidas com o novo nome');
  // restaurar o nome original
  await renomear(page, 'Diversão', 'Lazer');
  eq([(await cu(page)).renomes, await lerTx(page)], [{}, [[1, 'Lazer'], [2, 'Lazer'], [3, 'Moradia']]], 'voltar ao nome original apaga o renome e religa tudo');
  // renomear categoria adicionada
  await reset(page, { tx: [T(1, 'Pets', 5)], orc: { Pets: 50 }, rec: [R(1, 'Pets')], cu: { adicionadas: [{ nome: 'Pets', cor: '#123456' }] } });
  await renomear(page, 'Pets', 'Bichos');
  eq([await lerTx(page), await page.evaluate(() => orcamentos), (await cu(page)).adicionadas], [[[1, 'Bichos']], { Bichos: 50 }, [{ nome: 'Bichos', cor: '#123456' }]], 'adicionada: renome muda lançamento, orçamento e mantém a cor');
  // validações do renome
  await reset(page, { tx: [T(1, 'Lazer')], cu: { adicionadas: [{ nome: 'Pets', cor: '#123456' }] } });
  dialogos.length = 0;
  await renomear(page, 'Lazer', 'Moradia');
  eq([(await cu(page)).renomes, dialogos], [{}, ['Já existe uma categoria "Moradia".']], 'renomear para nome de outra categoria: bloqueia com alerta');
  await renomear(page, 'Lazer', 'pets');
  eq((await cu(page)).renomes, {}, 'renomear para nome de outra em outra caixa: bloqueia');
  await renomear(page, 'Lazer', '   ');
  eq((await cu(page)).renomes, {}, 'renomear para só espaços: ignora');
  await renomear(page, 'Lazer', 'Lazer');
  eq((await cu(page)).renomes, {}, 'renomear para o mesmo nome: ignora');
  await renomear(page, 'Lazer', 'lazer');
  eq([(await cu(page)).renomes, await lerTx(page)], [{ Lazer: 'lazer' }, [[1, 'lazer']]], 'mudar só a caixa ("lazer") é aceito e propaga');
  await reset(page, { tx: [T(1, 'Lazer')] });
  await renomear(page, 'Lazer', 'Receita');
  eq((await cu(page)).renomes, { Lazer: 'Receita' }, '[BUG-CONHECIDO] renomear para o nome reservado "Receita" é ACEITO (adicionar bloqueia "Receita"/"Transferência"); esperado: bloquear');
  await reset(page, { tx: [T(1, 'Lazer')] });
  await renomear(page, 'Lazer', 'x'.repeat(80));
  eq((await cu(page)).renomes.Lazer.length, 80, '[BUG-CONHECIDO] renomear aceita nome de 80 caracteres (adicionar limita a 30); esperado: mesmo limite');
  // renomear para o nome de uma padrão oculta
  await reset(page, { tx: [T(1, 'Lazer')] });
  await excluir(page, 'Doação');
  await renomear(page, 'Lazer', 'Doação');
  eq([(await cu(page)).renomes, (await cu(page)).ocultas], [{ Lazer: 'Doação' }, ['Doação']], 'renomear para o nome de uma padrão oculta é aceito (a oculta continua oculta)');

  // ================= 4. excluir =================
  console.log('4. excluirCategoria');
  await reset(page, { cu: { adicionadas: [{ nome: 'Pets', cor: '#123456' }] } });
  await excluir(page, 'Pets');
  eq([(await cu(page)).adicionadas, (await moverBox(page)).aberto], [[], false], 'adicionada SEM uso: some direto, sem painel');
  await excluir(page, 'Doação');
  eq([(await cu(page)).ocultas, await page.evaluate(() => CATEGORIAS_PADRAO.includes('Doação')), (await ativas(page)).includes('Doação')], [['Doação'], true, false], 'padrão SEM uso: fica oculta (constante intacta, some da lista)');
  await excluir(page, 'Outros');
  ok((await ativas(page)).includes('Outros') && !(await cu(page)).ocultas.includes('Outros'), '"Outros" não pode ser excluída (excluirCategoria é no-op)');
  ok(!(await page.evaluate(() => document.getElementById('listaCategorias').innerHTML.includes("excluirCategoria('p:Outros')"))), '… e a linha de "Outros" não tem botão ×');
  // com uso → destino
  await reset(page, { tx: [T(1, 'Lazer', 30), T(2, 'Lazer', 5, { data: '2026-08-02' }), T(3, 'Saúde', 80)], orc: { Lazer: 100, Saúde: 200 }, rec: [R(1, 'Lazer', 40)], cu: { adicionadas: [{ nome: 'Pets', cor: '#123456' }] } });
  await excluir(page, 'Lazer');
  let mb = await moverBox(page);
  ok(mb.aberto && /"Lazer" tem 2 lançamentos, o orçamento, 1 conta fixa\./.test(mb.txt), 'com uso: abre o painel "mover para" descrevendo o uso');
  ok(!mb.destinos.includes('Lazer') && mb.destinos.includes('Outros') && mb.destinos.includes('Pets'), 'destinos = todas as ativas, exceto a que está sendo excluída');
  eq(mb.padrao, 'Moradia', 'destino pré-selecionado = 1ª categoria ativa da lista');
  eq(await lerTx(page), [[1, 'Lazer'], [2, 'Lazer'], [3, 'Saúde']], 'nada muda antes de confirmar');
  await page.evaluate(() => cancelarMoverCategoria());
  eq([(await moverBox(page)).aberto, await lerTx(page)], [false, [[1, 'Lazer'], [2, 'Lazer'], [3, 'Saúde']]], 'cancelar fecha o painel e não altera nada');
  await excluir(page, 'Lazer');
  await mover(page, 'Saúde');
  eq(await lerTx(page), [[1, 'Saúde'], [2, 'Saúde'], [3, 'Saúde']], 'mover → lançamentos reatribuídos (todos os meses)');
  eq(await page.evaluate(() => orcamentos), { Saúde: 300 }, 'mover → orçamento SOMADO ao do destino (100 + 200)');
  eq(await page.evaluate(() => recorrentes.map(r => r.categoria)), ['Saúde'], 'mover → conta fixa reatribuída');
  ok((await cu(page)).ocultas.includes('Lazer') && !(await ativas(page)).includes('Lazer'), 'a padrão excluída fica oculta');
  ok(await page.evaluate(() => document.getElementById('toast').textContent.includes('movidos para')), 'toast "itens movidos para …"');
  eq(await page.evaluate(() => JSON.parse(localStorage.getItem('bc_orcamentos'))), { Saúde: 300 }, 'orçamentos persistidos');
  // destino sem orçamento herda o limite
  await reset(page, { tx: [T(1, 'Lazer')], orc: { Lazer: 100 } });
  await excluir(page, 'Lazer'); await mover(page, 'Transporte');
  eq(await page.evaluate(() => orcamentos), { Transporte: 100 }, 'destino sem limite HERDA o limite da excluída');
  // excluir o "destino padrão" (a 1ª da lista) e o painel passa a oferecer a próxima
  await reset(page, { tx: [T(1, 'Moradia')], orc: {} });
  await excluir(page, 'Moradia');
  mb = await moverBox(page);
  eq([mb.padrao, mb.destinos.includes('Moradia')], ['Condomínio', false], 'excluir a categoria que era o destino padrão (Moradia): a próxima vira o padrão e ela some das opções');
  await mover(page, mb.padrao);
  eq(await lerTx(page), [[1, 'Condomínio']], '… e mover para o novo padrão funciona');
  // cadeia: mover para B, depois excluir B
  await reset(page, { tx: [T(1, 'Lazer'), T(2, 'Saúde')], orc: { Lazer: 10 } });
  await excluir(page, 'Lazer'); await mover(page, 'Saúde');
  await excluir(page, 'Saúde'); await mover(page, 'Educação');
  eq([await lerTx(page), await page.evaluate(() => orcamentos), (await cu(page)).ocultas.sort()], [[[1, 'Educação'], [2, 'Educação']], { Educação: 10 }, ['Lazer', 'Saúde']], 'cadeia: A→B e depois B→C leva tudo (lançamentos e limite) para C');
  // destino = categoria renomeada
  await reset(page, { tx: [T(1, 'Lazer'), T(2, 'Saúde')] });
  await renomear(page, 'Saúde', 'Médico');
  await excluir(page, 'Lazer');
  ok((await moverBox(page)).destinos.includes('Médico') && !(await moverBox(page)).destinos.includes('Saúde'), 'destinos usam o nome EFETIVO (renomeada aparece com o nome novo)');
  await mover(page, 'Médico');
  eq(await lerTx(page), [[1, 'Médico'], [2, 'Médico']], 'mover para a renomeada');
  // excluir uma padrão RENOMEADA com uso
  await reset(page, { tx: [T(1, 'Lazer')] });
  await renomear(page, 'Lazer', 'Diversão'); await excluir(page, 'Diversão'); await mover(page, 'Outros');
  eq([(await cu(page)).renomes, (await cu(page)).ocultas, await lerTx(page)], [{}, ['Lazer'], [[1, 'Outros']]], 'padrão renomeada e excluída: oculta o padrão, limpa o renome, lançamentos vão para o destino');
  // orçamento de limite 0/ausente não conta como uso
  await reset(page, { tx: [], orc: { Lazer: 0 } });
  await excluir(page, 'Lazer');
  eq([(await moverBox(page)).aberto, (await cu(page)).ocultas, await page.evaluate(() => orcamentos)], [false, ['Lazer'], { Lazer: 0 }], '[BUG-CONHECIDO] orçamento com valor 0 não conta como uso: a categoria some SEM painel e a chave órfã { Lazer: 0 } fica no orçamento (esperado: limpar)');
  // lançamento com categoria fora da lista (editar não troca em silêncio)
  await reset(page, { tx: [T(1, 'Fantasma', 12)] });
  await page.evaluate(() => editar(1));
  eq(await page.evaluate(() => [document.getElementById('categoria').value, [...document.getElementById('categoria').options].find(o => o.value === 'Fantasma').textContent]), ['Fantasma', 'Fantasma (fora da lista)'], 'editar() com categoria fora da lista injeta a opção "(fora da lista)" e a mantém selecionada');
  await page.evaluate(() => cancelarEdicao());
  eq(await page.evaluate(() => [...document.getElementById('categoria').options].some(o => o.value === 'Fantasma')), true, '[BUG-CONHECIDO] a opção transitória "Fantasma (fora da lista)" continua no select depois de cancelar a edição (só some no próximo popularSelectsEstaticos); esperado: removê-la');

  // palpite de categoria × renome/ocultação (pacote A): o palpite passa pelo mapa de renomes e nunca devolve
  // uma categoria que não existe na lista; e salvar nunca grava categoria vazia
  await reset(page);
  eq(await page.evaluate(() => palpitarCategoria('IFOOD pedido')), 'Alimentação', 'sem renome: o palpite segue "Alimentação"');
  eq(await page.evaluate(() => palpitarCategoria('xyz sem palavra chave')), null, 'sem palavra-chave: nenhum palpite (null)');
  await renomear(page, 'Alimentação', 'Comida');
  eq(await page.evaluate(() => palpitarCategoria('IFOOD pedido')), 'Comida', 'palpitarCategoria passa pelo mapa de renomes: "IFOOD pedido" → "Comida"');
  await page.evaluate(() => abrirModalRapido());
  await page.evaluate(() => { document.getElementById('rapValor').value = '10'; document.getElementById('rapDesc').value = 'ifood'; rapidoAtualizarPalpite(); });
  eq(await page.evaluate(() => document.getElementById('rapCategoria').value), 'Comida', 'registro rápido: o palpite escolhe "Comida" no select (a categoria renomeada)');
  ok(/Categoria sugerida: Comida/.test(await page.evaluate(() => document.getElementById('rapPalpite').textContent)), 'e a dica diz "Categoria sugerida: Comida"');
  await page.evaluate(() => salvarRapido());
  eq(await page.evaluate(() => transacoes[0].categoria), 'Comida', '… e o gasto é salvo em "Comida" (nunca com categoria vazia)');
  // categoria padrão ocultada (excluída sem uso): cai em "Outros"
  await reset(page);
  await excluir(page, 'Alimentação');
  eq(await page.evaluate(() => palpitarCategoria('IFOOD pedido')), 'Outros', 'categoria padrão OCULTADA: o palpite cai em "Outros"');
  await page.evaluate(() => abrirModalRapido());
  await page.evaluate(() => { document.getElementById('rapValor').value = '10'; document.getElementById('rapDesc').value = 'ifood'; rapidoAtualizarPalpite(); });
  eq(await page.evaluate(() => document.getElementById('rapCategoria').value), 'Outros', 'registro rápido com a categoria sugerida oculta: o select vai para "Outros"');
  await page.evaluate(() => salvarRapido());
  eq(await page.evaluate(() => transacoes[0].categoria), 'Outros', '… e salva em "Outros"');
  // padrão renomeada e depois excluída com destino: nada de nome antigo
  await reset(page, { tx: [T(1, 'Alimentação')] });
  await renomear(page, 'Alimentação', 'Comida'); await excluir(page, 'Comida'); await mover(page, 'Lazer');
  eq(await page.evaluate(() => palpitarCategoria('ifood')), 'Outros', 'renomeada e depois excluída: o palpite cai em "Outros"');
  // outros palpites: transporte renomeado
  await reset(page);
  await renomear(page, 'Transporte', 'Deslocamento');
  eq(await page.evaluate(() => [palpitarCategoria('uber viagem'), palpitarCategoria('netflix')]), ['Deslocamento', 'Assinaturas'], 'cada palpite usa o nome efetivo da SUA categoria (Transporte→Deslocamento; Assinaturas intacta)');
  // importação de extrato usa o mesmo palpite
  await reset(page);
  await renomear(page, 'Alimentação', 'Comida');
  const catImport = await page.evaluate(async () => {
    await iniciarImportacao('Outros', new File(['<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20260906<TRNAMT>-20.00<FITID>A1<NAME>IFOOD PEDIDO</BANKTRANLIST></OFX>'], 'a.ofx'));
    const c = importacaoPendente.itens.map(i => i.categoria); fecharModalImportar(); return c;
  });
  eq(catImport, ['Comida'], 'importação de extrato: a categoria sugerida também respeita o renome');
  // salvar nunca grava categoria vazia (fallback "Outros")
  await reset(page);
  await page.evaluate(() => abrirModalRapido());
  await page.evaluate(() => { document.getElementById('rapCategoria').innerHTML = ''; document.getElementById('rapValor').value = '5'; document.getElementById('rapDesc').value = 'qualquer'; salvarRapido(); });
  eq(await page.evaluate(() => transacoes[0].categoria), 'Outros', 'registro rápido com select de categoria vazio: salva em "Outros" (nunca "")');
  await page.evaluate(async () => { document.getElementById('categoria').innerHTML = ''; document.getElementById('tipo').value = 'gasto'; document.getElementById('descricao').value = 'form sem categoria'; document.getElementById('valor').value = '7'; document.getElementById('conta').value = 'Outros'; await adicionar(); });
  eq(await page.evaluate(() => transacoes[0].categoria), 'Outros', 'formulário completo com select de categoria vazio: salva em "Outros"');
  await page.evaluate(() => { document.getElementById('recCategoria').innerHTML = ''; document.getElementById('recTipo').value = 'gasto'; document.getElementById('recDesc').value = 'fixa sem categoria'; document.getElementById('recValor').value = '9'; criarRecorrente(); });
  eq(await page.evaluate(() => recorrentes[recorrentes.length - 1].categoria), 'Outros', 'conta que se repete com select vazio: salva em "Outros"');
  await page.evaluate(() => { document.getElementById('tipo').value = 'receita'; });
  eq(await page.evaluate(async () => { document.getElementById('descricao').value = 'salario'; document.getElementById('valor').value = '100'; await adicionar(); return transacoes[0].categoria; }), 'Receita', 'receita continua sempre com a categoria "Receita"');
  // lançamentos JÁ gravados com categoria "" NÃO são reescritos (pacote A), mas na EXIBIÇÃO aparecem como "Outros" (pacote A2)
  await reset(page, { tx: [T(1, '', 90), T(2, 'Alimentação', 10), T(3, 'Outros', 5)], orc: { Outros: 100 } });
  eq(await page.evaluate(() => transacoes.map(t => t.categoria)), ['', 'Alimentação', 'Outros'], 'o dado gravado NÃO é reescrito: o lançamento antigo continua com categoria "" na memória');
  eq(await page.evaluate(() => JSON.parse(localStorage.getItem('bc_transacoes')).map(t => t.categoria)), ['', 'Alimentação', 'Outros'], '… e no localStorage');
  eq(await page.evaluate(() => [categoriaExibida({ tipo: 'gasto', categoria: '' }), categoriaExibida({ tipo: 'gasto' }), categoriaExibida({ tipo: 'gasto', categoria: 'Lazer' }), categoriaExibida({ tipo: 'receita', categoria: '' }), categoriaExibida({ tipo: 'transferencia', categoria: '' })]), ['Outros', 'Outros', 'Lazer', 'Receita', 'Transferência'], 'helper categoriaExibida: "" → Outros (gasto), Receita (receita), Transferência (transferência); categoria real fica como está');
  await page.evaluate(() => { mudarAbaPrincipal('lancamentos'); render(); });
  const vazia = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('#corpoTabela tr')].map(tr => (tr.querySelector('.col-cat') || {}).textContent.trim());
    document.getElementById('filtroCategoria').value = 'Outros'; render();
    const filtradas = document.querySelectorAll('#corpoTabela tr').length;
    document.getElementById('filtroCategoria').value = ''; render();
    mudarAbaPrincipal('geral'); render();
    return {
      chips,
      filtradas,
      paraOnde: [...document.querySelectorAll('#paraOndeLista .po-row')].map(r => r.querySelector('.po-nome').textContent + ' | ' + r.querySelector('.po-valor').textContent.replace(/\s+/g, ' ')),
      orc: [...document.querySelectorAll('#orcamentos .orc-row')].map(r => r.querySelector('.orc-label').textContent + ' | ' + r.querySelector('.orc-val').textContent.replace(/\s+/g, ' ')),
      dica: [...document.querySelectorAll('#listaDicas .alert')].map(a => a.textContent.replace(/\s+/g, ' ')).find(t => /maior categoria/.test(t)) || '',
      uso: contarUsoCategoria('Outros'),
    };
  });
  eq(vazia.chips.slice().sort(), ['Alimentação', 'Outros', 'Outros'], 'tabela: o lançamento com categoria "" mostra o chip "Outros" (nenhum chip vazio)');
  eq(vazia.filtradas, 2, 'filtro por categoria "Outros" inclui o lançamento antigo com "" (2 linhas: o "" e o "Outros" real)');
  eq(vazia.paraOnde, ['Outros | R$ 95,00', 'Alimentação | R$ 10,00'], '"Para onde foi o dinheiro": o "" soma com o "Outros" real numa linha só (90 + 5 = 95), sem linha de nome vazio');
  eq(vazia.orc, ['Alimentação | R$ 10,00', 'Outros | R$ 95,00 / R$ 100,00'], 'lista de orçamento: "Outros" junta o "" com o real (95 de 100), sem rótulo vazio');
  ok(/Sua maior categoria de gasto é Outros, representando 90% do total gasto no mês\./.test(vazia.dica), 'dica: "Sua maior categoria de gasto é Outros, representando 90% do total gasto no mês." (sem duplicar nem quebrar)');
  eq(await risco(page), [{ cat: 'Outros', val: '95% · R$ 95,00 / R$ 100,00' }], '"Orçamento em risco" conta o "" dentro de "Outros" (95% do limite de 100)');
  eq((await alertasOrc(page)).length, 1, 'alerta de orçamento de "Outros" também considera o "" (1 alerta, 95%)');
  eq(vazia.uso, { tx: 2, orc: 1, rec: 0, total: 3 }, 'contarUsoCategoria("Outros") conta o "" junto (2 lançamentos + orçamento)');
  await page.evaluate(() => editar(1));
  eq(await page.evaluate(() => document.getElementById('categoria').value), 'Outros', 'editar() num lançamento com categoria "" abre com "Outros" selecionado (e não "Moradia", que trocaria a categoria em silêncio ao salvar)');
  await page.evaluate(() => cancelarEdicao());
  eq(await page.evaluate(() => transacoes.map(t => t.categoria)), ['', 'Alimentação', 'Outros'], 'abrir e cancelar a edição não grava nada');

  // ================= 5. nomes hostis =================
  console.log('5. nomes com HTML, aspas e emoji');
  const P1 = '<img src=x onerror=__x=1>';
  const hostis = [[P1, 'tag HTML'], ['a"b\'c<d>&amp;', 'aspas, < > e &amp;'], ['🍕 Pizza', 'emoji'], ['a\\b', 'barra invertida']];
  for(const [nome, d] of hostis){
    await reset(page);
    eq(await addCat(page, nome), null, `${d}: aceita`);
    eq((await ativas(page)).slice(-1), [nome], `${d}: guardada exatamente como digitada`);
    ok((await opts(page, 'categoria')).includes(nome) && (await opts(page, 'filtroCategoria')).includes(nome), `${d}: aparece nos selects com o texto literal`);
    await page.evaluate(() => renderListaCategorias());
    eq(await page.evaluate(() => [document.querySelectorAll('#listaCategorias img').length, document.querySelectorAll('#listaCategorias .cat-row input')[12].value]), [0, nome], `${d}: no modal vira texto no campo de nome (sem elemento novo)`);
    eq(await page.evaluate(() => document.querySelectorAll('#toast img').length), 0, `${d}: toast sem HTML injetado`);
  }
  // superfícies: onde o nome aparece depois de usado
  await reset(page, {
    tx: [T(1, P1, 90), T(2, P1, 10, { data: '2026-08-05' }), T(3, 'Moradia', 10, { data: '2026-08-05' })], orc: { [P1]: 100 }, rec: [R(1, P1, 5)],
    cu: { adicionadas: [{ nome: P1, cor: '#123456' }] },
  });
  await page.evaluate(() => { mudarAbaPrincipal('lancamentos'); render(); mudarAbaPrincipal('metas'); render(); mudarAbaPrincipal('orcamento'); render(); mudarAbaPrincipal('geral'); render(); toggleOrcEdit(); renderListaCategorias(); });
  const vaza = await page.evaluate(() => Object.fromEntries(['#corpoTabela', '#orcamentos', '#listaOrcamentoRisco', '#paraOndeLista', '#recorrentes', '#alertas', '#listaDicas', '#orcEdit', '#listaCategorias'].map(s => [s, document.querySelectorAll(s + ' img[src="x"]').length])));
  for(const s of ['#paraOndeLista', '#orcEdit', '#listaCategorias']) eq(vaza[s], 0, `${s}: nome da categoria escapado (sem HTML injetado)`);
  const nomes = { '#corpoTabela': 'tabela de Lançamentos (etiqueta da categoria)', '#orcamentos': 'lista de Orçamento por categoria', '#listaOrcamentoRisco': 'card "Orçamento em risco"', '#recorrentes': 'lista de contas fixas', '#alertas': 'alertas de orçamento', '#listaDicas': 'Dicas' };
  for(const [s, d] of Object.entries(nomes)) ok(vaza[s] > 0, `[BUG-CONHECIDO] ${d}: o nome da categoria entra SEM escapar e vira HTML (${vaza[s]} <img> injetado); esperado: escHtml`);
  // origem não confiável: cor vinda de um backup/Drive adulterado
  await page.evaluate(async () => { await aplicarDadosImportados({ categoriasUsuario: { adicionadas: [{ nome: 'Ruim', cor: 'red;" onmouseover="window.__cor=1' }] } }); renderListaCategorias(); });
  eq(await page.evaluate(() => document.querySelectorAll('#listaCategorias [onmouseover]').length), 1, '[BUG-CONHECIDO] a cor de uma categoria importada (backup/Drive) entra no atributo style sem validação: aspas injetam atributo (onmouseover); esperado: aceitar só #hex');
  // clique no "Orçamento em risco" com aspas/apóstrofo no nome
  for(const [nome, funciona, d] of [["O'Brien", true, 'apóstrofo'], ['Lanche "rápido"', false, 'aspas duplas'], ['a\\b', false, 'barra invertida']]){
    await reset(page, { tx: [T(1, nome, 90)], orc: { [nome]: 100 }, cu: { adicionadas: [{ nome, cor: '#123456' }] } });
    await page.evaluate(() => { mudarAbaPrincipal('geral'); render(); });
    await page.evaluate(() => { const r = document.querySelector('#listaOrcamentoRisco .orc-row'); r && r.click(); });
    const filtro = await page.evaluate(() => document.getElementById('filtroCategoria').value);
    eq(filtro === nome, funciona, `${funciona ? '' : '[BUG-CONHECIDO] '}"Orçamento em risco" → toque na linha com ${d} no nome ${funciona ? 'leva ao filtro certo' : 'NÃO filtra pela categoria (onclick inline quebra); esperado: filtrar'}`);
  }

  // os payloads acima geram erros ESPERADOS: <img src=x> (arquivo inexistente) e o onclick inline quebrado pelas aspas
  eq([page.__erros.filter(e => /ERR_FILE_NOT_FOUND/.test(e)).length > 0, page.__erros.filter(e => /pageerror: .*Invalid or unexpected token/.test(e)).length], [true, 1], '[BUG-CONHECIDO] consequência observável dos payloads: <img src=x> tenta carregar "x" e o toque no risco com aspas dá SyntaxError na página');
  page.__erros.length = 0;

  // ================= 6. limites de orçamento =================
  console.log('6. limites de orçamento (setOrcamento)');
  await reset(page);
  for(const [v, esperado, d] of [['100', 100, '"100"'], ['1500,50', 1500.5, 'vírgula decimal'], ['1500.50', 1500.5, 'ponto decimal'], ['1.500,50', 1500.5, 'milhar com ponto + vírgula'], ['1.500', 1500, '"1.500" = mil e quinhentos (ponto + 3 dígitos)'],
    ['R$ 2.000,00', 2000, 'com R$'], ['0,5', 0.5, '"0,5"'], ['999999999999', 999999999999, 'valor muito alto (12 dígitos)'], ['0', null, 'zero REMOVE o limite'], ['', null, 'vazio REMOVE o limite'], ['   ', null, 'só espaços REMOVE'],
    ['abc', null, 'texto REMOVE'], ['-50', null, 'negativo REMOVE'], ['0,001', 0.001, '"0,001" (frações de centavo são aceitas)']]){
    eq(await setOrc(page, 'Lazer', v), esperado, `limite ${d}: ${JSON.stringify(v)} → ${esperado === null ? 'sem limite' : esperado}`);
  }
  eq(await setOrc(page, 'Lazer', '12abc'), 12, '"12abc" → 12 (parseFloat ignora o lixo no fim; caracterização)');
  eq(await setOrc(page, 'Lazer', '1e3'), 1000, '"1e3" → 1000 (notação científica aceita; caracterização)');
  await setOrc(page, 'Lazer', '500');
  await setOrc(page, 'Lazer', '0');
  eq(await page.evaluate(() => Object.keys(orcamentos)), [], 'zerar apaga a chave (não deixa { Lazer: 0 })');
  eq(await setOrc(page, 'Lazer', 'Infinity'), Infinity, '"Infinity" é aceito como limite');
  eq(await page.evaluate(() => localStorage.getItem('bc_orcamentos')), '{"Lazer":null}', '[BUG-CONHECIDO] limite Infinity/1e400 é gravado como null (JSON) e se perde ao recarregar; esperado: rejeitar na digitação');
  await setOrc(page, 'Lazer', '0');
  // exibição
  await reset(page, { tx: [T(1, 'Lazer', 30)], orc: { Lazer: 1500.5 } });
  await page.evaluate(() => { toggleOrcEdit(); });
  eq(await page.evaluate(() => document.querySelector('#orcEdit input[data-cat="Lazer"]').value), '1.500,5', 'editor mostra o limite em pt-BR ("1.500,5")');
  eq(await page.evaluate(() => document.querySelector('#orcEdit input[data-cat="Moradia"]').value), '', 'sem limite → campo vazio com placeholder');
  await page.evaluate(() => { toggleOrcEdit(); });
  await reset(page, { tx: [T(1, 'Lazer', 30)], orc: { Lazer: 999999999999 } });
  ok(/999\.999\.999\.999/.test(await page.evaluate(() => document.getElementById('orcamentos').textContent)), 'limite gigante é exibido formatado sem quebrar o render');
  eq(page.__erros, [], 'nenhum erro de console/página até aqui');

  // ================= 7. orçamento em risco: fronteiras =================
  console.log('7. "Orçamento em risco" e alertas — 79 / 80 / 100 / 101 %');
  const casosRisco = [
    [79, null, 'nenhum', '79%: fora do risco'],
    [80, '80% · R$ 80,00 / R$ 100,00', 'warning', '80%: entra (≥ 80%)'],
    [99.99, '100% · R$ 99,99 / R$ 100,00', 'warning', '99,99%: ainda "aviso" (o texto arredonda para 100%)'],
    [100, 'estourou · R$ 100,00 / R$ 100,00', 'danger', '100%: "estourou" (>= limite)'],
    [101, 'estourou · R$ 101,00 / R$ 100,00', 'danger', '101%: "estourou"'],
  ];
  for(const [gasto, textoRisco, tipoAlerta, d] of casosRisco){
    await reset(page, { tx: [T(1, 'Lazer', gasto)], orc: { Lazer: 100 } });
    const r = await risco(page);
    eq(r === null ? null : r[0].val, textoRisco, `card: ${d}`);
    const al = await alertasOrc(page);
    const esperadoAl = tipoAlerta === 'nenhum' ? 0 : 1;
    eq(al.length, esperadoAl, `alerta de orçamento: ${d} → ${esperadoAl} alerta(s)`);
    if(tipoAlerta === 'warning') ok(/já usou/.test(al[0]), `alerta é de aviso ("já usou …%")`);
    if(tipoAlerta === 'danger') ok(/estourou o orçamento/.test(al[0]), `alerta é de estouro`);
  }
  await reset(page, { tx: [T(1, 'Lazer', 80), T(2, 'Lazer', 0.5, { data: '2026-08-05' })], orc: { Lazer: 100 } });
  eq((await risco(page)) === null ? null : 'em risco', 'em risco', 'só o mês selecionado conta (0,50 de agosto não muda setembro)');
  // limites decimais e ponto flutuante
  await reset(page, { tx: [T(1, 'Lazer', 2.4)], orc: { Lazer: 3 } });
  eq(await risco(page), null, '[BUG-CONHECIDO] gasto 2,40 de limite 3,00 (exatamente 80%) NÃO entra em risco: 3 × 0,8 = 2,4000000000000004 no ponto flutuante; esperado: entrar');
  await reset(page, { tx: [T(1, 'Lazer', 0.8)], orc: { Lazer: 1 } });
  ok((await risco(page)) !== null, 'gasto 0,80 de limite 1 (80%): entra');
  await reset(page, { tx: [T(1, 'Lazer', 0.01)], orc: { Lazer: 0.01 } });
  eq((await risco(page))[0].val, 'estourou · R$ 0,01 / R$ 0,01', 'limite de 1 centavo com gasto igual: estourou');
  // sem limite / limite 0 / gasto 0
  await reset(page, { tx: [T(1, 'Lazer', 1000)], orc: {} });
  eq(await risco(page), null, 'gasto alto SEM limite: não aparece no risco');
  await reset(page, { tx: [], orc: { Lazer: 100 } });
  eq(await risco(page), null, 'limite sem gasto: não aparece');
  // ordenação e várias categorias
  await reset(page, { tx: [T(1, 'Lazer', 85), T(2, 'Saúde', 150), T(3, 'Moradia', 50), T(4, 'Transporte', 100)], orc: { Lazer: 100, Saúde: 100, Moradia: 100, Transporte: 100 } });
  eq((await risco(page)).map(r => r.cat), ['Saúde', 'Transporte', 'Lazer'], 'ordena do mais estourado para o menos; quem está em 50% fica de fora');
  // tocar leva às Lançamentos filtradas
  await page.evaluate(() => document.querySelector('#listaOrcamentoRisco .orc-row').click());
  eq(await page.evaluate(() => [document.body.dataset.aba, document.getElementById('filtroCategoria').value]), ['lancamentos', 'Saúde'], 'tocar na linha → aba Lançamentos filtrada pela categoria');
  // risco respeita renome
  await reset(page, { tx: [T(1, 'Lazer', 90)], orc: { Lazer: 100 } });
  await renomear(page, 'Lazer', 'Diversão');
  eq((await risco(page)).map(r => r.cat), ['Diversão'], 'depois de renomear, o risco usa o nome novo');
  // gasto pendente conta?
  await reset(page, { tx: [T(1, 'Lazer', 90, { status: 'pendente', data: '2026-09-20' })], orc: { Lazer: 100 } });
  ok((await risco(page)) !== null, 'gasto PENDENTE do mês conta no risco (caracterização: o orçamento mede o comprometido)');
  await reset(page, { tx: [T(1, 'Lazer', 90, { tipo: 'receita', categoria: 'Lazer' })], orc: { Lazer: 100 } });
  eq(await risco(page), null, 'receita na mesma categoria não conta');

  // ================= 8. persistência: recarregar =================
  console.log('8. persistência — recarregar a página');
  await reset(page);
  await addCat(page, 'Pets');
  await renomear(page, 'Lazer', 'Diversão');
  await excluir(page, 'Doação');
  await page.evaluate(() => { transacoes = [{ ...{ id: 1, tipo: 'gasto', desc: 'ração', valor: 50, conta: 'Outros', data: '2026-09-05', status: 'pago' }, categoria: 'Pets' }]; salvarTx(); setOrcamento('Pets', '200'); setOrcamento('Diversão', '1.234,56'); });
  const antes = await page.evaluate(() => ({ ativas: categoriasAtivas(), cu: categoriasUsuario, orc: orcamentos }));
  await page.reload({ waitUntil: 'load' });
  await page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => getComputedStyle(document.getElementById('telaInicial')).display === 'none');
  const depois = await page.evaluate(() => ({ ativas: categoriasAtivas(), cu: categoriasUsuario, orc: orcamentos }));
  eq(depois, antes, 'categoria nova + renome + ocultada + limites sobrevivem a recarregar (carregar() lê o storage)');
  eq(depois.orc, { Pets: 200, Diversão: 1234.56 }, 'limites novos sobrevivem');
  for(const id of ['categoria', 'filtroCategoria', 'recCategoria']) ok((await opts(page, id)).includes('Pets') && (await opts(page, id)).includes('Diversão') && !(await opts(page, id)).includes('Doação'), `select #${id} reconstruído após recarregar`);
  eq(await page.evaluate(() => document.getElementById('orcamentos').textContent.includes('Pets')), true, 'lista de orçamento mostra "Pets" após recarregar');

  // ================= 9. funil de estado =================
  console.log('9. funil de estado — montarEstado / aplicarDadosImportados / backup');
  eq(await page.evaluate(() => Object.keys(montarEstado()).includes('categoriasUsuario') && Object.keys(montarEstado()).includes('orcamentos')), true, 'montarEstado() inclui categoriasUsuario e orcamentos');
  const blob = await page.evaluate(() => JSON.parse(JSON.stringify(montarEstado())));
  const { page: p2 } = await abrir(browser, { fixed: FIX });
  p2.on('dialog', d => d.accept());
  eq(await p2.evaluate(() => [categoriasAtivas().includes('Pets'), Object.keys(orcamentos).length]), [false, 0], 'aparelho B começa limpo');
  await p2.evaluate(async b => { await aplicarDadosImportados(b); render(); }, blob);
  eq(await p2.evaluate(() => ({ ativas: categoriasAtivas(), cu: categoriasUsuario, orc: orcamentos })), depois, 'aplicarDadosImportados reproduz categorias, renomes, ocultas e limites');
  for(const id of ['categoria', 'filtroCategoria', 'recCategoria']) ok((await opts(p2, id)).includes('Pets') && (await opts(p2, id)).includes('Diversão'), `aparelho B: select #${id} reconstruído pelo import`);
  eq(await p2.evaluate(() => [JSON.parse(localStorage.getItem('bc_categoriasUsuario')).adicionadas.map(x => x.nome), JSON.parse(localStorage.getItem('bc_orcamentos'))]), [['Pets'], { Pets: 200, Diversão: 1234.56 }], 'import grava no storage (sobrevive a recarregar)');
  await p2.reload({ waitUntil: 'load' });
  await p2.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
  await p2.waitForFunction(() => getComputedStyle(document.getElementById('telaInicial')).display === 'none');
  eq(await p2.evaluate(() => ({ ativas: categoriasAtivas(), orc: orcamentos })), { ativas: depois.ativas, orc: depois.orc }, 'aparelho B: depois de recarregar continua igual');
  // backup por arquivo (importarBackupJSON)
  const { page: p3 } = await abrir(browser, { fixed: FIX });
  p3.on('dialog', d => d.accept());
  await p3.evaluate(async b => { await importarBackupJSON(new File([JSON.stringify(b)], 'backup.json')); }, blob);
  eq(await p3.evaluate(() => ({ ativas: categoriasAtivas(), orc: orcamentos })), { ativas: depois.ativas, orc: depois.orc }, 'importarBackupJSON (arquivo) restaura categorias e limites');
  eq(await p3.evaluate(() => transacoes.map(t => t.categoria)), ['Pets'], '… e os lançamentos com a categoria nova');
  // exportar → importar (backup gerado pelo próprio app)
  const exportado = await p3.evaluate(async () => { let cap; const o = URL.createObjectURL; URL.createObjectURL = b => { cap = b; return o.call(URL, b); }; exportarBackupJSON(); URL.createObjectURL = o; return JSON.parse(await cap.text()); });
  eq([exportado.categoriasUsuario, exportado.orcamentos], [depois.cu, depois.orc], 'exportarBackupJSON leva categoriasUsuario e orcamentos');
  // blob antigo (sem o campo)
  await p3.evaluate(async () => { await aplicarDadosImportados({ transacoes: [], contas: ['Outros'], orcamentos: { Moradia: 5 } }); });
  eq(await p3.evaluate(() => ({ cu: categoriasUsuario, orc: orcamentos })), { cu: depois.cu, orc: { Moradia: 5 } }, 'blob antigo (sem categoriasUsuario) → MANTÉM as categorias locais (campo ausente não zera); o limite do blob vale');
  eq(await p3.evaluate(() => categoriasAtivas()), depois.ativas, '… e a lista de categorias ativas continua a mesma');
  await p3.evaluate(async () => { await aplicarDadosImportados({}); });
  eq(await p3.evaluate(() => [categoriasUsuario, orcamentos]), [depois.cu, { Moradia: 5 }], 'blob {} → não muda NADA (todos os campos ausentes mantêm o local)');
  eq(await p3.evaluate(async () => { const antes = JSON.stringify(categoriasUsuario); try{ await aplicarDadosImportados({ categoriasUsuario: 'lixo', orcamentos: null }); return 'aceitou'; }catch(e){ return [e.codigo, JSON.stringify(categoriasUsuario) === antes, orcamentos]; } }), ['backup-invalido', true, { Moradia: 5 }], 'categoriasUsuario/orcamentos com lixo → blob REJEITADO (backup-invalido) e o local não muda');
  eq(await p3.evaluate(async () => { await aplicarDadosImportados({ transacoes: [{ id: 1, tipo: 'gasto', desc: 'x', valor: 1, categoria: 'Fantasma', conta: 'Outros', data: '2026-09-01', status: 'pago' }] }); return [transacoes[0].categoria, categoriasAtivas().includes('Fantasma')]; }), ['Fantasma', false], 'importar lançamento de categoria que não existe na lista local: mantém o nome (fica "fora da lista", sem perda)');
  eq([page.__erros, p2.__erros, p3.__erros], [[], [], []], 'nenhum erro de console/página nas 3 abas');

  await browser.close();
  const t = res(); console.log(`\n${t.pass} ok, ${t.fail} fail`); process.exit(t.fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
