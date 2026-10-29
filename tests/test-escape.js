// Escape de HTML (P4 da leva 2): nenhum texto digitado/importado pelo usuário pode virar elemento, atributo ou
// manipulador de evento. Dois testes:
//  1) GUARDA do código-fonte: varre o index.html atrás de ${...} com texto do usuário dentro de HTML sem escHtml.
//     Falha listando as linhas — um novo ponto sem escape quebra o teste. Exceções só na lista EXCECOES (comentadas).
//  2) DINÂMICO: semeia payloads (<img onerror>, aspas que fecham atributo, </script>, barra invertida, emoji) em categoria,
//     descrição, tag, conta, cartão, meta, conta fixa, orçamento e saldo; percorre abas, sub-abas, modais, toasts e alertas
//     e confirma que nada injetado existe no DOM e nenhum código executou.
// Relógio fixo 10/09/2026 12:00 BRT, PostHog bloqueado, sem waitForTimeout.
const fs = require('fs'), path = require('path');
const { chromium, ok, abrir, res } = require('./lib');
const { HELPERS } = require('./a11y-helpers');
const FIX = '2026-09-10T12:00:00-03:00';
const eq = (a, b, n) => { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, A === B ? n : `${n}  [obtido ${A} | esperado ${B}]`); };

// ======================= 1. GUARDA DO CÓDIGO-FONTE =======================
console.log('1. guarda: texto do usuário em HTML sem escHtml');
const FONTE_TXT = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
// identificadores que carregam TEXTO DO USUÁRIO (nome/descrição/etiqueta/categoria/conta/meta/cartão)
const TEXTO = /\b(desc|nome|nomeConta|categoria|categoriaExibida|cat|conta|contaDestino|tag|meta|cartao|titulo|anexo)\b|\.nome\b|\.desc\b|\.cat\b|\.tag\b|\.categoria\b|\.conta\b/;
// o que NÃO conta como texto cru: já escapado, ou número/data/valor formatado
const SEGURO = /escHtml\(|\bfmt\w*\(|toFixed|toLocale|Math\.|\.length|\.id\b|\bidx\b|\.chave\b/;
// EXCEÇÕES explícitas, casadas pela EXPRESSÃO ${...} (não pela linha, para não esconder um ${t.desc} na mesma linha).
// Cada uma com o motivo.
const EXCECOES = [
  [/^t\.fixo\?/, 'expressão condicional que só devolve um <span> estático com a palavra "fixo" (o identificador "tag" está dentro do literal, não é texto do usuário)'],
  [/^corCategoria\(/, 'devolve uma cor já validada por corHexValida() (só #hex) ou o cinza padrão — nunca texto livre'],
];
// ---- scanner de template literals (multilinha e aninhados): cada template vira { texto, exprs:[{expr, linha}], inicio, linha }
function escanearTemplates(src){
  const out = [];
  const linhaDe = (pos) => src.slice(0, pos).split('\n').length;
  // devolve o índice logo após o fim do template que começa em `i` (src[i] === '`'); registra o template e os aninhados
  function template(i){
    const inicio = i; i++;
    let texto = ''; const exprs = [];
    while(i < src.length){
      const c = src[i];
      if(c === '\\'){ texto += src.substr(i, 2); i += 2; continue; }
      if(c === '`'){ out.push({ texto, exprs, inicio, linha: linhaDe(inicio) }); return i + 1; }
      if(c === '$' && src[i + 1] === '{'){
        let j = i + 2, prof = 1; const ini = j;
        while(j < src.length && prof > 0){
          const d = src[j];
          if(d === '`'){ j = template(j); continue; }                        // template aninhado dentro da expressão
          if(d === '"' || d === "'"){ const q = d; j++; while(j < src.length && src[j] !== q){ if(src[j] === '\\') j++; j++; } j++; continue; }
          if(d === '{') prof++;
          else if(d === '}'){ prof--; if(prof === 0) break; }
          j++;
        }
        exprs.push({ expr: src.slice(ini, j), linha: linhaDe(i) });
        texto += '\u0000';                                                   // marcador de interpolação
        i = j + 1; continue;
      }
      texto += c; i++;
    }
    return i;
  }
  let i = 0;
  while(i < src.length){
    const c = src[i];
    if(c === '/' && src[i + 1] === '/'){ while(i < src.length && src[i] !== '\n') i++; continue; }
    if(c === '/' && src[i + 1] === '*'){ i = src.indexOf('*/', i + 2) + 2; if(i < 2) break; continue; }
    if(c === '"' || c === "'"){ const q = c; i++; while(i < src.length && src[i] !== q && src[i] !== '\n'){ if(src[i] === '\\') i++; i++; } i++; continue; }
    if(c === '`'){ i = template(i); continue; }
    i++;
  }
  return out;
}

const templates = escanearTemplates(FONTE_TXT);
ok(templates.length > 250, `scanner leu ${templates.length} template literals do index.html (multilinha e aninhados)`);
const achados = [];
let htmlTemplates = 0;
for(const t of templates){
  const antes = FONTE_TXT.slice(Math.max(0, t.inicio - 70), t.inicio);
  // é HTML (ou vai para innerHTML) se tem tag, ou é argumento de toast/innerHTML/html:
  const ehHtml = /<[a-zA-Z\/!]/.test(t.texto) || /(mostrarToast|commitTransacoes|insertAdjacentHTML)\(\s*(?:'[^']*'\s*,\s*)?$|innerHTML\s*\+?=\s*$|html:\s*$|document\.write\(\s*$/.test(antes);
  if(!ehHtml) continue;
  htmlTemplates++;
  for(const e of t.exprs){
    const expr = e.expr.trim();
    if(!TEXTO.test(expr) || SEGURO.test(expr)) continue;
    if(EXCECOES.some(([re]) => re.test(expr))) continue;
    achados.push(`${e.linha}: \${${expr.slice(0, 70)}}`);
  }
  // <option> com interpolação direta de nome de conta (o identificador é "c")
  if(/<option[^>]*>\u0000<\/option>/.test(t.texto) && t.exprs.some(e => e.expr.trim() === 'c')) achados.push(`${t.linha}: <option>\${c}</option> (nome de CONTA sem escHtml)`);
  // onclick/onchange com texto do usuário embutido entre aspas simples (quebra com aspas no nome)
  const m = t.texto.match(/on(?:click|change|input)="[^"]*'\u0000'/g);
  if(m) achados.push(`${t.linha}: handler on*="...'\${...}'..." com texto embutido entre aspas simples`);
}
ok(htmlTemplates > 40, `${htmlTemplates} templates de HTML/toast auditados`);
eq(achados, [], 'nenhum ${...} com nome/descrição/etiqueta/categoria/conta/meta/cartão entra em HTML ou toast sem escHtml (inclui templates multilinha, <option> de contas e onclick com aspas embutidas)');
ok(EXCECOES.length > 0 && EXCECOES.every(e => e[0] instanceof RegExp && e[1].length > 20), `exceções declaradas: ${EXCECOES.length} (cada uma com regex e motivo)`);

// ======================= 2. DINÂMICO =======================
(async () => {
  console.log('2. dinâmico: payloads em todas as telas');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const { page } = await abrir(browser, { fixed: FIX, vp: { width: 390, height: 844 } });
  page.on('dialog', d => d.accept());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'load' });
  await page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => getComputedStyle(document.getElementById('telaInicial')).display === 'none');
  await page.evaluate(HELPERS);

  const IMG = '<img src=x onerror=__x=1>';              // 25 caracteres (cabe no limite de categoria)
  const ATTR = 'Z"><b id=injetado>x</b>';                // fecha atributo e abre elemento
  const SCRIPT = '</script><i id=injetado2>s</i>';
  const ASPAS = `Lanche "rápido" e d'água \\ 🍕`;
  const detectar = (raiz) => page.evaluate(sel => {
    const r = sel ? document.querySelector(sel) : document.body;
    const achados = [...r.querySelectorAll('img[src="x"], #injetado, #injetado2, [onerror], [onmouseover]')];
    return achados.map(e => (e.closest('[id]:not(#injetado):not(#injetado2)') || {}).id || e.tagName);
  }, raiz);
  const semInjecao = async (rotulo, raiz) => eq(await detectar(raiz), [], `${rotulo}: nada injetado no DOM`);

  // ---- semente
  await page.evaluate(async ([IMG, ATTR, SCRIPT, ASPAS]) => {
    contas = [IMG, ATTR, 'Outros'];
    contasDetalhes = { [ATTR]: { tipo: 'cartao', diaFechamento: 25, diaVencimento: 5 } };
    saldosIniciais = { [IMG]: { valor: 100, em: '2026-09-01' }, [ATTR]: { valor: 50, em: '2026-09-01' } };
    categoriasUsuario = { adicionadas: [{ nome: IMG, cor: '#123456' }, { nome: ATTR, cor: '#654321' }, { nome: ASPAS, cor: '#abcdef' }], renomes: {}, ocultas: [] };
    orcamentos = { [IMG]: 100, [ATTR]: 40, [ASPAS]: 60 };
    transacoes = [
      { id: 1, tipo: 'gasto', desc: ATTR, valor: 90, categoria: IMG, conta: IMG, data: '2026-09-05', status: 'pago', tag: ATTR },
      { id: 2, tipo: 'gasto', desc: IMG, valor: 45, categoria: ATTR, conta: ATTR, data: '2026-09-04', status: 'pendente' },        // vencida
      { id: 3, tipo: 'gasto', desc: SCRIPT, valor: 30, categoria: IMG, conta: IMG, data: '2026-09-12', status: 'pendente' },     // a vencer
      { id: 4, tipo: 'gasto', desc: ASPAS, valor: 55, categoria: ASPAS, conta: IMG, data: '2026-09-06', status: 'pago', fixo: true },
      { id: 5, tipo: 'receita', desc: ATTR, valor: 3000, categoria: 'Receita', conta: IMG, data: '2026-09-02', status: 'pago' },
      { id: 6, tipo: 'gasto', desc: IMG, valor: 10, categoria: IMG, conta: IMG, data: '2026-08-04', status: 'pago' },                // mês anterior (média)
      { id: 7, tipo: 'gasto', desc: 'Comprovante', valor: 5, categoria: 'Outros', conta: 'Outros', data: '2026-09-07', status: 'pago', anexo: 'data:image/png;base64,AAAA"onerror="__x=1' },
    ];
    metas = [{ id: 1, nome: IMG, valorAlvo: 1000, valorAtual: 100, prazo: '2026-11-01' }, { id: 2, nome: ATTR, valorAlvo: 500, valorAtual: 10, prazo: '2026-10-15' }];
    recorrentes = [{ id: 1, tipo: 'gasto', desc: ATTR, valor: 10, categoria: IMG }, { id: 2, tipo: 'gasto', desc: IMG, valor: 20, categoria: ASPAS }];
    await salvarTx(); await salvarOrc(); await salvarMetas(); await salvarRec(); await salvarContas(); await salvarCategorias();
    mesAtual = '2026-09'; popularSelectsEstaticos(); popularSeletorMes(); document.getElementById('mesSel').value = '2026-09'; render();
  }, [IMG, ATTR, SCRIPT, ASPAS]);

  // ---- abas e sub-abas
  for(const [aba, sub, sec] of [['geral', 'resumo', '#secGeral'], ['geral', 'analise', '#secGeral'], ['lancamentos', 'resumo', '#secLancamentos'], ['orcamento', 'resumo', '#secOrcamento'], ['metas', 'resumo', '#secMetas']]){
    await page.evaluate(([a, s]) => { mudarAbaPrincipal(a); if(a === 'geral') mudarSubAbaGeral(s); }, [aba, sub]);
    await page.waitForFunction(() => window.__a11y.quieto());
    await semInjecao(`aba ${aba}${aba === 'geral' ? '/' + sub : ''}`, sec);
  }
  await page.evaluate(() => { mudarAbaPrincipal('lancamentos'); mudarAba('dicas'); render(); });
  await semInjecao('Lançamentos › Dicas (maior categoria, acima da média, meta apertada, conta a pagar)', '#viewDicas');
  eq(await page.evaluate(() => [...document.querySelectorAll('#listaDicas .alert')].map(a => a.textContent).some(t => t.includes('<img src=x onerror=__x=1>'))), true, '… e o nome aparece como TEXTO literal nas dicas (não some)');
  await page.evaluate(() => { mudarAba('lista'); render(); });

  // ---- onde o texto deve aparecer LITERAL
  await page.evaluate(() => { mudarAbaPrincipal('lancamentos'); render(); });
  const tab = await page.evaluate(() => document.getElementById('corpoTabela').textContent);
  ok(tab.includes('Z"><b id=injetado>x</b>') && tab.includes('<img src=x onerror=__x=1>'), 'tabela de Lançamentos: descrição, etiqueta, conta e categoria aparecem como texto literal');
  await page.evaluate(() => { mudarAbaPrincipal('geral'); render(); });
  const alertas = await page.evaluate(() => document.getElementById('alertas').textContent);
  ok(alertas.includes('<img src=x onerror=__x=1>') || alertas.includes('Z"><b id=injetado>x</b>'), 'alertas (conta vencida / a vencer / categoria no limite) mostram os nomes como texto literal');

  // ---- selects de contas
  await page.evaluate(() => { abrirModalRapido(); });
  const opts = await page.evaluate(() => Object.fromEntries(['conta', 'contaDestino', 'contaFiltro', 'rapConta'].map(id => [id, [...document.getElementById(id).options].map(o => o.value)])));
  for(const id of ['conta', 'contaDestino', 'contaFiltro', 'rapConta']){
    ok(opts[id].includes(IMG) && opts[id].includes(ATTR), `select #${id}: as opções têm o NOME exato das contas (com < > e aspas)`);
  }
  await semInjecao('selects de conta', 'body');

  // ---- modais
  for(const [id, abrir] of [
    ['modalContas', () => abrirModalContas()], ['modalCategorias', () => abrirModalCategorias()], ['modalAvisos', () => abrirModalAvisos()],
    ['modalRapido', () => abrirModalRapido()], ['modalEvolucaoMeta', () => verEvolucaoMeta(1)], ['modalExcluirParcela', () => { document.getElementById('modalExcluirParcelaTexto').textContent = 'x'; document.getElementById('modalExcluirParcela').style.display = 'flex'; }],
  ]){
    await page.evaluate(() => document.querySelectorAll('.modal-bg').forEach(m => { m.style.display = 'none'; }));
    await page.evaluate(abrir);
    await semInjecao(`modal ${id}`, '#' + id);
  }
  // editor de limites do orçamento
  await page.evaluate(() => { document.querySelectorAll('.modal-bg').forEach(m => { m.style.display = 'none'; }); mudarAbaPrincipal('orcamento'); render(); const e = document.getElementById('orcEdit'); if(e.style.display === 'none') toggleOrcEdit(); });
  await semInjecao('editor de limites', '#orcEdit');
  // lista de contas: os campos precisam operar com o NOME exato (sem aspas embutidas no onclick/id)
  await page.evaluate(() => { document.querySelectorAll('.modal-bg').forEach(m => { m.style.display = 'none'; }); abrirModalContas(); });
  const operaConta = await page.evaluate(async ([IMG, ATTR]) => {
    const cards = [...document.querySelectorAll('#listaContas [data-conta]')].map(c => c.dataset.conta);
    const campo = [...document.querySelectorAll('#listaContas [data-conta]')].find(c => c.dataset.conta === ATTR).querySelector('input[type=text]');
    campo.value = '321,00'; campo.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    return { cards, saldoAtt: saldosIniciais[ATTR] && saldosIniciais[ATTR].valor };
  }, [IMG, ATTR]);
  eq([operaConta.cards.includes(IMG), operaConta.cards.includes(ATTR), operaConta.saldoAtt], [true, true, 321], 'modal de contas: cada cartão guarda o NOME exato em data-conta e editar o saldo funciona com aspas/< > no nome');

  // ---- "Orçamento em risco": toque leva ao filtro certo, para qualquer nome
  for(const nome of [IMG, ATTR, ASPAS, "O'Brien", 'a\\b']){
    const r = await page.evaluate(async nome => {
      if(!categoriasUsuario.adicionadas.some(c => c.nome === nome)){ categoriasUsuario.adicionadas.push({ nome, cor: '#111111' }); }
      transacoes = [{ id: 1, tipo: 'gasto', desc: 'g', valor: 90, categoria: nome, conta: 'Outros', data: '2026-09-05', status: 'pago' }]; orcamentos = { [nome]: 100 };
      popularSelectsEstaticos(); mudarAbaPrincipal('geral'); render();
      const row = document.querySelector('#listaOrcamentoRisco .orc-row'); if(row) row.click();
      return document.getElementById('filtroCategoria').value;
    }, nome);
    eq(r, nome, `"Orçamento em risco": tocar na linha com o nome ${JSON.stringify(nome)} filtra pela categoria certa (sem SyntaxError)`);
  }

  // ---- toasts com texto do usuário
  const toasts = await page.evaluate(async ([IMG, ATTR]) => {
    const out = [];
    transacoes = [{ id: 10, tipo: 'gasto', desc: IMG, valor: 5, categoria: 'Outros', conta: 'Outros', data: '2026-09-10', status: 'pendente' }, { id: 11, tipo: 'gasto', desc: ATTR, valor: 5, categoria: 'Outros', conta: 'Outros', data: '2026-09-10', status: 'pago' }];
    recorrentes = [{ id: 9, tipo: 'gasto', desc: IMG, valor: 1, categoria: 'Outros' }];
    const lerToast = () => { const t = document.getElementById('toast'); return { html: t.innerHTML, img: t.querySelectorAll('img, #injetado').length, texto: t.textContent }; };
    marcarComoPago(10); out.push(['marcar como pago', lerToast()]);
    remover(11); out.push(['excluir', lerToast()]);
    lancarRecorrente(9); out.push(['lançar conta fixa', lerToast()]);
    return out;
  }, [IMG, ATTR]);
  for(const [nome, t] of toasts) eq([t.img, t.texto.includes('<img src=x onerror=__x=1>') || t.texto.includes('Z"><b id=injetado>x</b>')], [0, true], `toast "${nome}": o texto do usuário aparece literal e não vira elemento`);

  // ---- janela do comprovante
  const comprovante = await page.evaluate(() => {
    let escrito = ''; window.open = () => ({ document: { write: h => { escrito += h; } } });
    transacoes = [{ id: 7, tipo: 'gasto', desc: '</title><img src=x onerror=__x=1>', valor: 5, categoria: 'Outros', conta: 'Outros', data: '2026-09-07', status: 'pago', anexo: 'data:image/png;base64,AAAA"onerror="__x=1' }];
    verAnexo(7); return escrito;
  });
  ok(!/<title><\/title>|<img src=x onerror|src="data:image\/png;base64,AAAA"onerror=/.test(comprovante) && comprovante.includes('&lt;/title&gt;'), 'janela do comprovante: título e src da imagem escapados (nada de </title> nem atributo extra)');

  // ---- cor da categoria: só #hex
  const cores = await page.evaluate(() => {
    const n = normalizarCategoriasUsuario({ adicionadas: [{ nome: 'A', cor: 'red;" onmouseover="window.__cor=1' }, { nome: 'B', cor: '#abc' }, { nome: 'C', cor: '#ABCDEF' }, { nome: 'D', cor: 'rgb(1,2,3)' }, { nome: 'E', cor: 'url(javascript:1)' }] });
    categoriasUsuario = { adicionadas: [{ nome: 'F', cor: 'red;" onmouseover="window.__cor=1' }], renomes: {}, ocultas: [] };
    renderListaCategorias(); popularSelectsEstaticos();
    return { cores: n.adicionadas.map(x => x.cor), corF: corCategoria('F'), onmouse: document.querySelectorAll('#listaCategorias [onmouseover]').length };
  });
  eq([/^#[0-9a-f]{6}$/i.test(cores.cores[0]), cores.cores[1], cores.cores[2], /^#[0-9a-f]{6}$/i.test(cores.cores[3]), /^#[0-9a-f]{6}$/i.test(cores.cores[4])], [true, '#abc', '#ABCDEF', true, true], 'cor da categoria: só #hex (3 ou 6 dígitos) é aceita; qualquer outra coisa cai numa cor automática da paleta');
  eq([/^#[0-9a-f]{3,6}$/i.test(cores.corF), cores.onmouse], [true, 0], 'cor inválida que já estava no estado: corCategoria() devolve uma cor segura e o atributo não injeta onmouseover');

  eq(await page.evaluate(() => typeof window.__x + '/' + typeof window.__cor), 'undefined/undefined', 'nenhum código dos payloads executou (window.__x e window.__cor continuam indefinidos)');
  eq(page.__erros.filter(e => !/ERR_FILE_NOT_FOUND/.test(e)), [], 'nenhum erro de página (SyntaxError de onclick quebrado etc.)');
  eq(page.__erros.filter(e => /ERR_FILE_NOT_FOUND/.test(e)).length, 0, 'e nenhum <img src=x> tentou carregar o arquivo "x" (nenhuma injeção chegou ao DOM)');
  await browser.close();
  const t = res(); console.log(`\n${t.pass} ok, ${t.fail} fail`); process.exit(t.fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
