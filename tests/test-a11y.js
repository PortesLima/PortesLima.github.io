// Acessibilidade: documento, contraste WCAG (cores computadas), teclado e foco, modais, rótulos acessíveis,
// alvos de toque. Mede o DOM real (nada é alterado). Caracteriza o comportamento ATUAL; o que falha leva
// [BUG-CONHECIDO] no nome do check. Relógio fixo 10/09/2026 12:00 BRT, PostHog bloqueado, sem waitForTimeout.
// LIMITE: leitor de tela real (VoiceOver/TalkBack) e o desenho do <input type=date> no iOS não são cobertos aqui.
const { chromium, ok, abrir, res } = require('./lib');
const { HELPERS, preparar, MODAIS, fecharTodos } = require('./a11y-helpers');
const FIX = '2026-09-10T12:00:00-03:00';
const eq = (a, b, n) => { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, A === B ? n : `${n}  [obtido ${A} | esperado ${B}]`); };
const TELAS = [['geral', 'resumo'], ['geral', 'analise'], ['lancamentos', 'resumo'], ['orcamento', 'resumo'], ['metas', 'resumo']];
const nomeTela = ([a, s]) => a === 'geral' ? `${a}/${s}` : a;
const quieto = (page) => page.waitForFunction(() => window.__a11y.quieto());
const irPara = async (page, aba, sub = 'resumo') => { await page.evaluate(([a, s]) => { mudarAbaPrincipal(a); if(a === 'geral') mudarSubAbaGeral(s); }, [aba, sub]); await quieto(page); };
const tema = (page, t) => page.evaluate(x => aplicarTema(x), t);
const unicos = (l) => [...new Set(l)];
// tira o conteúdo dinâmico do rótulo para listas estáveis
const tipo = (d) => d.replace(/ ".*"$/, '').replace(/^(\w+)(#\S+)?(\.\S+)?/, (m) => m);

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const { page } = await abrir(browser, { fixed: FIX, vp: { width: 390, height: 844 } });
  page.on('dialog', d => d.accept());
  await page.evaluate(HELPERS);
  await preparar(page, 'cheio');

  // ================= 1. documento =================
  console.log('1. documento');
  eq(await page.evaluate(() => document.documentElement.lang), 'pt-BR', '<html lang="pt-BR">');
  ok((await page.title()).trim().length > 3, `<title> descritivo (${await page.title()})`);
  eq(await page.evaluate(() => /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/.test(document.querySelector('meta[name=viewport]').content)), false, 'o viewport não bloqueia o zoom do usuário');
  eq(await page.evaluate(() => [...document.querySelectorAll('h1')].filter(h => window.__a11y.visivel(h)).length), 1, 'exatamente 1 <h1> visível no app');
  eq(await page.evaluate(() => document.querySelectorAll('nav[aria-label], [role=navigation][aria-label]').length >= 1), true, 'a navegação principal é um <nav> com aria-label ("Seções do app")');
  eq(await page.evaluate(() => [document.querySelectorAll('main, [role=main]').length, document.querySelectorAll('header, [role=banner]').length]), [0, 0], '[BUG-CONHECIDO] o app não tem landmark <main> nem <header>/banner: leitor de tela não consegue "pular para o conteúdo principal"; esperado: <main> envolvendo as seções');
  for(const [a, s] of TELAS){
    await irPara(page, a, s);
    const saltos = await page.evaluate(() => {
      const hs = [...document.querySelectorAll('h1,h2,h3,h4')].filter(h => window.__a11y.visivel(h)).map(h => parseInt(h.tagName[1]));
      let pulos = 0; for(let i = 1; i < hs.length; i++) if(hs[i] - hs[i - 1] > 1) pulos++;
      return { n: hs.length, pulos };
    });
    eq(saltos.pulos, 0, `${nomeTela([a, s])}: hierarquia de títulos sem saltos (${saltos.n} títulos visíveis)`);
  }
  eq(await page.evaluate(() => { const t = document.getElementById('toast'); return [t.getAttribute('role'), t.getAttribute('aria-live')]; }), ['status', 'polite'], 'o toast é uma região viva (role=status, aria-live=polite)');
  eq(await page.evaluate(() => ['categoriaErro', 'pinErro'].map(i => { const e = document.getElementById(i); return !!(e.getAttribute('role') === 'alert' || e.getAttribute('aria-live')); })), [false, false], '[BUG-CONHECIDO] as mensagens de erro de formulário (#categoriaErro, #pinErro) NÃO são região viva (sem role=alert/aria-live): o leitor de tela não anuncia "Já existe uma categoria…" nem "PIN incorreto"; esperado: role=alert');

  // ================= 2. contraste =================
  console.log('2. contraste de texto (WCAG, cores computadas)');
  const chipsFalha = {}, phFalha = {};
  for(const [w, h] of [[390, 844], [1280, 800]]){
    await page.setViewportSize({ width: w, height: h });
    for(const t of ['dark', 'light']){
      await tema(page, t);
      for(const tl of TELAS){
        await irPara(page, tl[0], tl[1]);
        const c = await page.evaluate(() => { const r = window.__a11y.contraste(), p = window.__a11y.placeholders(); return { medidos: r.medidos, incertos: r.incertos, falhas: r.falhas.filter(f => !/^button#fab/.test(f.el)), phFalhas: p.falhas }; });
        ok(c.medidos > 15, `${w}px · ${t} · ${nomeTela(tl)}: ${c.medidos} textos medidos (${c.incertos} sobre gradiente, não medidos)`);
        const chips = c.falhas.filter(f => /^span.tag/.test(f.el)), resto = c.falhas.filter(f => !/^span.tag/.test(f.el));
        eq(resto.map(f => `${f.el} ${f.razao}:1`), [], `${w}px · ${t} · ${nomeTela(tl)}: todo texto (exceto as etiquetas de categoria) ≥ 4,5:1 (≥ 3:1 se grande)`);
        chips.forEach(f => { (chipsFalha[`${w}-${t}`] = chipsFalha[`${w}-${t}`] || new Set()).add(f.el.replace(/^span.tag /, '') + ' ' + f.razao + ':1'); });
        c.phFalhas.forEach(f => { (phFalha[`${w}-${t}`] = phFalha[`${w}-${t}`] || new Set()).add(f.razao); });
      }
    }
  }
  eq([...(chipsFalha['390-dark'] || [])].sort(), ['"Outros" 4.27:1'], '390px · dark: [BUG-CONHECIDO] a etiqueta de categoria "Outros" na tabela tem contraste 4,27:1 (texto cinza sobre o próprio tom a 13%); esperado ≥ 4,5:1');
  eq([...(chipsFalha['390-light'] || [])].sort(), ['"Alimentação" 1.73:1', '"Moradia" 2.17:1', '"Outros" 2.44:1', '"Receita" 1.73:1', '"pago" 4.16:1', '"vencido" 4.49:1'], '390px · light: [BUG-CONHECIDO] no tema CLARO as etiquetas de categoria (Alimentação 1,73:1, Receita 1,73:1, Moradia 2,17:1, Outros 2,44:1) e de status (pago 4,16:1, vencido 4,49:1) ficam bem abaixo de 4,5:1 — texto na cor da categoria sobre o próprio tom a 13%; esperado: texto escuro derivado da cor');
  eq((chipsFalha['1280-light'] || new Set()).size > 0, true, `1280px · light: [BUG-CONHECIDO] as etiquetas de categoria também falham no desktop do tema claro (${[...(chipsFalha['1280-light'] || [])].sort().join(', ')}); no escuro (1280px) falham ${(chipsFalha['1280-dark'] || new Set()).size}`);
  eq([[...(phFalha['390-dark'] || [])], [...(phFalha['390-light'] || [])]], [[3.49], [4.08]], '[BUG-CONHECIDO] o texto dos placeholders tem contraste 3,49:1 (escuro) e 4,08:1 (claro), abaixo de 4,5:1; esperado ≥ 4,5:1');
  await page.setViewportSize({ width: 390, height: 844 });
  for(const t of ['dark', 'light']){
    await tema(page, t); await irPara(page, 'geral');
    const f = await page.evaluate(() => { const fab = document.getElementById('fab'), A = window.__a11y; const cs = getComputedStyle(fab); const fg = cs.color.match(/[\d.]+/g).map(Number), bg = cs.backgroundColor.match(/[\d.]+/g).map(Number); return { razao: Math.round(A.razao({ r: fg[0], g: fg[1], b: fg[2] }, { r: bg[0], g: bg[1], b: bg[2] }) * 100) / 100, px: parseFloat(cs.fontSize) }; });
    if(f.razao < 3) eq(f.razao < 3, true, `${t}: [BUG-CONHECIDO] o "+" do FAB tem contraste ${f.razao}:1 (texto grande exige 3:1) — branco/escuro sobre o azul do botão; esperado ≥ 3:1`);
    else ok(true, `${t}: o "+" do FAB tem contraste ${f.razao}:1 (≥ 3:1, texto grande)`);
  }
  // modais e telas especiais, nos dois temas
  for(const t of ['dark', 'light']){
    await tema(page, t);
    const fal = [];
    for(const [id, abrirFn] of Object.entries(MODAIS)){
      await fecharTodos(page); await page.evaluate(abrirFn); await quieto(page);
      const r = await page.evaluate(id => { const c = window.__a11y.contraste(document.getElementById(id)); return { n: c.medidos, f: c.falhas.map(x => `${x.el} ${x.razao}:1`) }; }, id);
      if(r.f.length) fal.push(`${id}: ${r.f.join(' | ')}`);
    }
    await fecharTodos(page);
    if(t === 'dark') eq(fal, ['modalRapido: button#rapGasto "Gasto" 2.74:1', 'modalImportar: span.import-data "06/09" 4.36:1 | span.import-valor "− R$ 10,00" 4.5:1'], `${t}: [BUG-CONHECIDO] no tema escuro o botão "Gasto" do registro rápido tem 2,74:1 e a data/valor do extrato importado 4,36:1 / 4,49:1 (abaixo de 4,5:1); nos outros 9 modais o texto passa`);
    else eq(fal, [], `${t}: contraste de texto em TODOS os 11 modais`);
    const esp = await page.evaluate(() => {
      const out = [];
      for(const id of ['telaInicial', 'telaPin']){
        const el = document.getElementById(id), antes = el.style.display;
        el.style.display = 'flex';
        const c = window.__a11y.contraste(el); out.push(...c.falhas.map(x => `${id}: ${x.el} ${x.razao}:1`));
        el.style.display = antes;
      }
      return out;
    });
    eq(esp, [], `${t}: contraste na tela inicial e na tela de PIN`);
  }
  // contraste de componentes (não-texto, WCAG 1.4.11): borda dos campos contra o fundo
  for(const t of ['dark', 'light']){
    await tema(page, t); await irPara(page, 'lancamentos');
    const r = await page.evaluate(() => {
      const A = window.__a11y, out = [];
      const rgb = s => { const m = s.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
      for(const el of document.querySelectorAll('#secLancamentos input:not([type=checkbox]):not([type=file]), #secLancamentos select')){
        if(!A.visivel(el)) continue;
        const cs = getComputedStyle(el), pai = A.fundo(el.parentElement);
        const borda = rgb(cs.borderTopColor), fundoCampo = rgb(cs.backgroundColor);
        const rb = A.razao({ r: borda.r, g: borda.g, b: borda.b }, pai), rf = A.razao({ r: fundoCampo.r, g: fundoCampo.g, b: fundoCampo.b }, pai);
        out.push(Math.max(rb, rf));
      }
      return { n: out.length, min: Math.round(Math.min(...out) * 100) / 100, abaixo: out.filter(x => x < 3).length };
    });
    eq(r.abaixo === r.n, true, `${t}: [BUG-CONHECIDO] o limite visual dos campos de formulário (borda ou fundo contra o cartão) tem contraste ≤ ${r.min}:1 em ${r.abaixo} de ${r.n} campos — WCAG 1.4.11 pede 3:1 para identificar o campo; esperado: borda ≥ 3:1`);
  }

  // ================= 3. teclado: foco visível e alcance =================
  console.log('3. teclado — foco visível e alcance');
  await tema(page, 'dark');
  for(const tl of [['geral', 'resumo'], ['lancamentos', 'resumo'], ['orcamento', 'resumo'], ['metas', 'resumo']]){
    await irPara(page, tl[0], tl[1]);
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    const paradas = [];
    for(let i = 0; i < 70; i++){
      await page.keyboard.press('Tab');
      const p = await page.evaluate(() => { const e = document.activeElement; if(!e || e === document.body) return null; const f = window.__a11y.indicadorFoco(e); const uaDesenha = /^(date|time|month|datetime-local)$/.test(e.type); return { d: window.__a11y.desc(e), ok: f.ok || uaDesenha, visivel: window.__a11y.visivel(e) }; }); // date/time: o navegador destaca o sub-campo interno
      if(p) paradas.push(p);
    }
    const semIndicador = unicos(paradas.filter(p => !p.ok).map(p => tipo(p.d)));
    ok(paradas.length >= 8, `${nomeTela(tl)}: o Tab percorre ${paradas.length} elementos focáveis`);
    eq(semIndicador, [], `${nomeTela(tl)}: todo elemento focado pelo teclado mostra indicador de foco (outline/sombra)`);
    eq(paradas.filter(p => !p.visivel).map(p => p.d), [], `${nomeTela(tl)}: o foco nunca cai em elemento invisível`);
  }
  // tudo que reage a clique tem de ser alcançável por teclado
  for(const tl of TELAS){
    await irPara(page, tl[0], tl[1]);
    const mortos = await page.evaluate(() => [...document.querySelectorAll('[onclick]')].filter(e => window.__a11y.visivel(e) && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY)$/.test(e.tagName) && !(e.getAttribute('role') === 'button' && e.tabIndex >= 0) && !e.closest('button, a[href]')).map(e => window.__a11y.desc(e)));
    if(tl[0] === 'lancamentos') eq(mortos, ['div#tabLista "Lançamentos"', 'div#tabDicas "Dicas"'], `${nomeTela(tl)}: [BUG-CONHECIDO] as sub-abas "Lançamentos" e "Dicas" são <div onclick> sem role, sem tabindex e sem tecla: não dá para usá-las pelo teclado nem pelo leitor de tela; esperado: <button role="tab"> (como Resumo/Análise)`);
    else eq(mortos, [], `${nomeTela(tl)}: todo elemento clicável é botão/link ou tem role="button" + tabindex`);
  }
  await irPara(page, 'geral');
  eq(await page.evaluate(() => [...document.querySelectorAll('[role=button]')].filter(e => window.__a11y.visivel(e) && e.tagName !== 'BUTTON' && e.tabIndex < 0).map(window.__a11y.desc)), [], 'role="button" fora de <button> sempre com tabindex');
  // Enter/Espaço em role=button
  const acionou = await page.evaluate(() => new Promise(res => { const s = document.createElement('span'); s.setAttribute('role', 'button'); s.tabIndex = 0; s.textContent = 'x'; document.body.appendChild(s); let n = 0; s.addEventListener('click', () => n++); s.focus(); s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); s.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); s.remove(); res(n); }));
  eq(acionou, 2, 'Enter e Espaço acionam elementos role="button" (handler global)');

  // ================= 4. modais: Esc, foco, semântica =================
  console.log('4. modais — Esc, foco, trap e semântica de diálogo');
  const ids = Object.keys(MODAIS);
  const naoFecham = [], semFocoDentro = [], escapam = [], semSemantica = [];
  for(const id of ids){
    await fecharTodos(page);
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
    await page.evaluate(MODAIS[id]); await quieto(page);
    const sem = await page.evaluate(id => { const m = document.getElementById(id), box = m.querySelector('.modal-box'); return { role: (m.getAttribute('role') || box.getAttribute('role')) === 'dialog' || (m.getAttribute('role') || box.getAttribute('role')) === 'alertdialog', modal: [m, box].some(e => e.getAttribute('aria-modal') === 'true'), nome: [m, box].some(e => e.getAttribute('aria-label') || e.getAttribute('aria-labelledby')) }; }, id);
    if(!(sem.role && sem.modal && sem.nome)) semSemantica.push(id);
    // o app foca o 1º campo de 2 modais 50 ms DEPOIS de abrir (setTimeout): espera o foco por condição (limite 400 ms), sem pausa fixa
    const dentro = await page.waitForFunction(id => document.getElementById(id).contains(document.activeElement), id, { timeout: 400 }).then(() => true, () => false);
    if(!dentro) semFocoDentro.push(id);
    // trap: 12 Tabs; o foco sai do modal?
    let saiu = false;
    for(let i = 0; i < 12; i++){ await page.keyboard.press('Tab'); if(await page.evaluate(id => { const a = document.activeElement; return a && a !== document.body && !document.getElementById(id).contains(a); }, id)){ saiu = true; break; } }
    if(saiu) escapam.push(id);
    await page.keyboard.press('Escape');
    const aberto = await page.evaluate(id => getComputedStyle(document.getElementById(id)).display !== 'none', id);
    if(aberto) naoFecham.push(id);
  }
  await fecharTodos(page);
  eq(semSemantica, ids, '[BUG-CONHECIDO] NENHUM dos 11 modais tem role="dialog" + aria-modal="true" + nome (aria-label/aria-labelledby): o leitor de tela não sabe que abriu um diálogo; esperado: todos');
  eq(naoFecham, ids.filter(i => true), '[BUG-CONHECIDO] a tecla Esc NÃO fecha nenhum dos 11 modais (não há handler de Escape); esperado: fechar o modal aberto');
  eq(semFocoDentro, ids.filter(i => !['modalRapido', 'modalOnboarding'].includes(i)), `[BUG-CONHECIDO] ao abrir ${ids.length - 2} dos ${ids.length} modais o foco NÃO vai para dentro dele (fica no botão que abriu / body); só o registro rápido (#rapValor) e o assistente de primeiros passos (#onbContaNome) focam o 1º campo, 50 ms depois; esperado: mover o foco para o diálogo em todos`);
  eq(escapam.length > 0, true, `[BUG-CONHECIDO] o foco do Tab ESCAPA do modal e anda pela página de fundo em ${escapam.length} de 11 modais (sem trap de foco); esperado: o Tab circula dentro do modal`);

  // foco volta ao gatilho
  console.log('4b. foco de volta ao botão que abriu o modal');
  const voltou = [];
  await page.setViewportSize({ width: 1280, height: 800 });
  await irPara(page, 'geral');
  const teste = async (nome, abrir, fechar, esperado) => {
    await fecharTodos(page);
    await page.evaluate(() => { document.getElementById('menuConfig').style.display = 'none'; });
    await abrir();
    await fechar();
    const ok1 = await page.evaluate(sel => document.activeElement && document.activeElement.matches(sel) , esperado);
    voltou.push([nome, ok1]);
  };
  await teste('FAB → registro rápido', async () => { await page.click('#fab'); }, async () => { await page.click('#modalRapido .iconbtn'); }, '#fab');
  await teste('Contas → modal de contas', async () => { await page.click('button[onclick="abrirModalContas()"].so-desktop'); }, async () => { await page.click('#modalContas button[onclick="fecharModalContas()"]:last-of-type'); }, 'button[onclick="abrirModalContas()"].so-desktop');
  await teste('⚙️ → Minha assinatura', async () => { await page.click('#btnConfig'); await page.click('button[onclick="abrirMinhaAssinatura()"]'); }, async () => { await page.click('#modalAssinatura button.secondary'); }, '#btnConfig');
  await teste('Avisos de vencimento', async () => { await page.click('#btnConfig'); await page.click('button[onclick*="abrirModalAvisos"]'); }, async () => { await page.click('#modalAvisos button[onclick="fecharModalAvisos()"]:last-of-type'); }, '#btnConfig');
  eq(voltou.filter(([, v]) => v).map(([n]) => n), [], '[BUG-CONHECIDO] ao fechar um modal o foco NÃO volta ao botão que o abriu em NENHUM dos 4 fluxos testados (' + voltou.map(([n]) => n).join(', ') + '): o usuário de teclado/leitor de tela cai no início da página; esperado: devolver o foco ao gatilho');
  await fecharTodos(page);
  await page.setViewportSize({ width: 390, height: 844 });

  // ================= 5. rótulos acessíveis =================
  console.log('5. rótulos acessíveis');
  await tema(page, 'dark');
  const semNomeBotao = new Set(), soSimbolo = new Set(), campos = new Set();
  let nBotoes = 0, nCampos = 0;
  for(const tl of TELAS){
    await irPara(page, tl[0], tl[1]);
    const r = await page.evaluate(() => ({ b: window.__a11y.botoesSemNome(), c: window.__a11y.camposSemRotulo() }));
    r.b.vazios.forEach(x => semNomeBotao.add(x)); r.b.soSimbolo.forEach(x => soSimbolo.add(x)); r.c.falhas.forEach(x => campos.add(x.el.replace(/ ".*"$/, '')));
    nBotoes += r.b.medidos; nCampos += r.c.medidos;
  }
  ok(nBotoes > 40 && nCampos > 20, `medidos: ${nBotoes} botões/links e ${nCampos} campos nas 5 telas`);
  eq([...semNomeBotao], [], 'nenhum botão/link visível sem NENHUM texto, aria-label ou title');
  const tiposSimbolo = unicos([...soSimbolo].map(s => s.replace(/^button\.?\S*? /, 'botão ').replace(/^(\w+)\S* /, '$1 ')));
  eq(tiposSimbolo.length > 0, true, `[BUG-CONHECIDO] botões só com símbolo e SEM aria-label (leitor de tela lê "vezes", "marca de verificação"…): ${tiposSimbolo.join(' · ')}; esperado: aria-label (Excluir, Editar, Duplicar, Marcar como pago)`);
  const camposLista = [...campos].sort();
  eq(camposLista.length > 5, true, `[BUG-CONHECIDO] campos de formulário SEM rótulo associado (só placeholder ou nada): ${camposLista.join(', ')}; placeholder some ao digitar e não é rótulo; esperado: <label for> ou aria-label em todos`);
  // svg e canvas
  const svgs = await page.evaluate(() => [...document.querySelectorAll('svg')].filter(s => !s.closest('[style*="display:none"]')).map(s => ({ d: window.__a11y.desc(s.parentElement), ok: s.getAttribute('aria-hidden') === 'true' || s.getAttribute('role') === 'img' || !!s.querySelector('title') })));
  eq(svgs.filter(s => !s.ok).length, svgs.length, `[BUG-CONHECIDO] os ${svgs.length} <svg> (logo da marca) não são decorativos nem nomeados (sem aria-hidden="true" nem role="img"+título): o leitor de tela pode ler o conteúdo do desenho; esperado: aria-hidden`);
  await irPara(page, 'geral', 'analise');
  const canv = await page.evaluate(() => [...document.querySelectorAll('canvas')].filter(c => window.__a11y.visivel(c)).map(c => ({ id: c.id, role: c.getAttribute('role'), label: (c.getAttribute('aria-label') || '').length })));
  ok(canv.length >= 4 && canv.every(c => c.role === 'img' && c.label > 15), `todos os ${canv.length} <canvas> visíveis da Análise têm role="img" e aria-label descritivo`);
  eq(await page.evaluate(() => document.querySelectorAll('img').length), 0, 'não há <img> no app (nada sem alt); o visualizador de comprovante é uma janela à parte');
  eq(await page.evaluate(() => /<img[^>]*alt=/.test(verAnexo.toString())), true, 'a janela do comprovante (verAnexo) escreve a <img> com alt="Comprovante: …" (escapado)');

  // ================= 6. alvos de toque =================
  console.log('6. alvos de toque (≥ 44×44, celular)');
  await page.setViewportSize({ width: 390, height: 844 });
  const alvosPorTela = {};
  for(const tl of TELAS){
    await irPara(page, tl[0], tl[1]);
    const r = await page.evaluate(() => window.__a11y.alvos(44));
    alvosPorTela[nomeTela(tl)] = r;
    ok(r.medidos >= 8, `${nomeTela(tl)}: ${r.medidos} alvos de toque medidos`);
  }
  // alvos estruturais: tudo o que a barra de abas e as listas prometem
  await irPara(page, 'lancamentos');
  eq(await page.evaluate(() => { const m = [...document.querySelectorAll('#corpoTabela .iconbtn')].filter(window.__a11y.visivel).map(e => Math.min(e.offsetWidth, e.offsetHeight)); return [m.length > 0, Math.min(...m) >= 44]; }), [true, true], 'botões de ação das linhas (✓ ✎ ⧉ ×) têm ≥ 44px');
  eq(await page.evaluate(() => Math.min(...[...document.querySelectorAll('#navPrincipal .tab')].map(t => t.offsetHeight)) >= 52), true, 'abas da barra inferior ≥ 52px de altura');
  const uniq = (r) => unicos(r.falhas.map(f => f.el.replace(/ ".*"$/, '').replace(/#\w+/, m => m)));
  const todas = unicos(Object.values(alvosPorTela).flatMap(r => r.falhas.map(f => f.el.replace(/ ".*"$/, ''))));
  eq(todas, [], `alvos de toque ≥ 44×44 no celular: nenhum tipo abaixo do mínimo (antes: ${todas.length} tipos abaixo)`);
  const exemplos = Object.entries(alvosPorTela).map(([t, r]) => `${t}: ${r.falhas.length}/${r.medidos}`).join(' · ');
  ok(true, `caracterização — alvos abaixo de 44px por tela: ${exemplos}`);
  // modais no celular
  const fModais = [];
  for(const [id, abrirFn] of Object.entries(MODAIS)){
    await fecharTodos(page); await page.evaluate(abrirFn); await quieto(page);
    const r = await page.evaluate(id => { const out = window.__a11y.alvos(44); return out.falhas.filter(f => true).length; }, id);
    fModais.push([id, r]);
  }
  await fecharTodos(page);
  ok(true, `caracterização — alvos abaixo de 44px (inclui os de trás do modal): ${fModais.map(([i, n]) => i + ' ' + n).join(' · ')}`);

  eq(page.__erros.filter(e => !/ERR_FILE_NOT_FOUND/.test(e)), [], 'nenhum erro de console/página');
  await browser.close();
  const t = res(); console.log(`\n${t.pass} ok, ${t.fail} fail`); process.exit(t.fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
