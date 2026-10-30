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
  eq(await page.evaluate(() => [document.querySelectorAll('main, [role=main]').length, document.querySelectorAll('header, [role=banner]').length]), [1, 1], 'o app tem 1 landmark <main> (as 4 seções) e 1 <header> (topo): o leitor de tela consegue "pular para o conteúdo principal" (antes: nenhum dos dois)');
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
  eq(await page.evaluate(() => ['categoriaErro', 'pinErro'].map(i => { const e = document.getElementById(i); return !!(e.getAttribute('role') === 'alert' || e.getAttribute('aria-live')); })), [true, true], 'as mensagens de erro de formulário (#categoriaErro, #pinErro) são região viva (role=alert): o leitor de tela anuncia "Já existe uma categoria…" e "PIN incorreto" (antes: não eram)');

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
  eq([...(chipsFalha['390-dark'] || [])].sort(), [], '390px · dark: todas as etiquetas de categoria e de status da tabela ≥ 4,5:1 (antes: "Outros" 4,27:1)');
  eq([...(chipsFalha['390-light'] || [])].sort(), [], '390px · light: todas as etiquetas de categoria e de status ≥ 4,5:1 — texto derivado da cor da categoria sobre o próprio tom a 13% (antes: Alimentação/Receita 1,73:1, Moradia 2,17:1, Outros 2,44:1, pago 4,16:1, vencido 4,49:1)');
  eq([(chipsFalha['1280-light'] || new Set()).size, (chipsFalha['1280-dark'] || new Set()).size], [0, 0], '1280px: as etiquetas também passam de 4,5:1 no desktop, nos dois temas (antes: falhavam no claro)');
  eq([[...(phFalha['390-dark'] || [])], [...(phFalha['390-light'] || [])]], [[], []], 'o texto dos placeholders passa de 4,5:1 nos dois temas (antes: 3,49:1 no escuro e 4,08:1 no claro)');
  // a função da etiqueta vale para QUALQUER cor (padrão e paleta do usuário), nos dois temas, sobre o pior fundo (--card2) e sobre o cartão
  for(const t of ['dark', 'light']){
    await tema(page, t);
    const fc = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement), A = window.__a11y;
      const rgb = h => { const v = _rgbDeHex(h); return { r: v[0], g: v[1], b: v[2] }; };
      const cores = [...Object.values(CORES_PADRAO), ...PALETA_CATEGORIA];
      const ruins = [];
      for(const base of ['--card2', '--card']){
        const b0 = rgb(css.getPropertyValue(base).trim());
        for(const c of cores){
          const fg = rgb(c), a = 0x22 / 255, bg = { r: fg.r * a + b0.r * (1 - a), g: fg.g * a + b0.g * (1 - a), b: fg.b * a + b0.b * (1 - a) };
          const txt = corTextoEtiqueta(c), r = A.razao(rgb(txt), bg);
          if(!(r >= 4.5) || !/^#[0-9a-f]{6}$/.test(txt)) ruins.push(c + ' sobre ' + base + ' -> ' + txt + ' ' + Math.round(r * 100) / 100);
        }
      }
      return { n: cores.length, ruins, invalida: corTextoEtiqueta('red;" onmouseover="x') };
    });
    eq([fc.n, fc.ruins], [25, []], `${t}: corTextoEtiqueta() dá ≥ 4,5:1 para as 13 cores padrão e as 12 da paleta, sobre --card2 e sobre --card`);
    eq(fc.invalida, 'red;" onmouseover="x', `${t}: cor que não é #hex passa sem mexer (nunca vira atributo novo; quem desenha já usa corHexValida)`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for(const t of ['dark', 'light']){
    await tema(page, t); await irPara(page, 'geral');
    const f = await page.evaluate(() => { const fab = document.getElementById('fab'), A = window.__a11y; const cs = getComputedStyle(fab); const fg = cs.color.match(/[\d.]+/g).map(Number), bg = cs.backgroundColor.match(/[\d.]+/g).map(Number); return { razao: Math.round(A.razao({ r: fg[0], g: fg[1], b: fg[2] }, { r: bg[0], g: bg[1], b: bg[2] }) * 100) / 100, px: parseFloat(cs.fontSize) }; });
    ok(f.razao >= 4.5, `${t}: o "+" do FAB tem contraste ${f.razao}:1 (≥ 4,5:1; antes: 2,74:1 no escuro)`);
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
    eq(fal, [], `${t}: contraste de texto em TODOS os modais (antes, no escuro: botão "Gasto" 2,74:1 e data/valor do extrato 4,36:1 / 4,49:1)`);
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
    eq(r.abaixo, 0, `${t}: o limite visual dos campos de formulário (borda ou fundo contra o cartão) tem contraste ≥ 3:1 em todos os ${r.n} campos (mínimo ${r.min}:1; WCAG 1.4.11; antes: abaixo de 3:1 em todos)`);
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
    if(tl[0] === 'lancamentos') eq(mortos, [], `${nomeTela(tl)}: as sub-abas "Lançamentos" e "Dicas" são <button role="tab"> alcançáveis pelo teclado (antes: <div onclick> sem role, sem tabindex e sem tecla)`);
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
  eq(semSemantica, [], `TODOS os ${ids.length} modais têm role="dialog" + aria-modal="true" + nome (aria-labelledby/aria-label); antes: nenhum tinha`);
  eq(naoFecham, ['modalDriveConflito', 'modalTrialFim', 'modalOnboarding'], `a tecla Esc fecha ${ids.length - 3} dos ${ids.length} modais; os 3 de decisão obrigatória (conflito do Drive, fim do teste, primeiros passos) continuam abertos de propósito (antes: Esc não fechava nenhum)`);
  eq(semFocoDentro, [], `ao abrir, o foco vai para DENTRO de todos os ${ids.length} modais (antes: ${ids.length - 2} deixavam o foco no botão que abriu)`);
  eq(escapam, [], `o foco do Tab NÃO escapa de nenhum dos ${ids.length} modais (Tab/Shift+Tab circulam dentro; antes escapava em ${ids.length})`);

  // foco volta ao gatilho
  console.log('4a. abas operáveis só pelo teclado');
  await page.setViewportSize({ width: 1280, height: 800 });
  await irPara(page, 'lancamentos');
  await page.focus('#tabLista');
  await page.keyboard.press('ArrowRight');
  eq(await page.evaluate(() => [document.activeElement.id, document.getElementById('tabDicas').getAttribute('aria-selected'), document.getElementById('tabLista').getAttribute('aria-selected'), document.getElementById('viewDicas').style.display, document.getElementById('viewLista').style.display, document.getElementById('tabDicas').tabIndex, document.getElementById('tabLista').tabIndex]), ['tabDicas', 'true', 'false', 'block', 'none', 0, -1], 'Lançamentos/Dicas: ArrowRight move e ativa "Dicas" (aria-selected, painel e tabindex móvel)');
  await page.keyboard.press('ArrowLeft');
  eq(await page.evaluate(() => [document.activeElement.id, document.getElementById('viewLista').style.display]), ['tabLista', 'block'], 'Lançamentos/Dicas: ArrowLeft volta para "Lançamentos"');
  await irPara(page, 'geral');
  await page.focus('#subtabResumo');
  await page.keyboard.press('ArrowRight');
  eq(await page.evaluate(() => [document.activeElement.id, document.getElementById('subtabAnalise').getAttribute('aria-selected'), document.getElementById('geralAnalise').style.display]), ['subtabAnalise', 'true', 'block'], 'Resumo/Análise: ArrowRight move e ativa "Análise"');
  await page.keyboard.press('Home');
  eq(await page.evaluate(() => [document.activeElement.id, document.getElementById('geralResumo').style.display]), ['subtabResumo', 'block'], 'Resumo/Análise: Home volta para "Resumo"');
  await page.focus('#navGeral');
  await page.keyboard.press('ArrowRight');
  eq(await page.evaluate(() => [document.activeElement.id, document.body.dataset.aba, document.getElementById('navLancamentos').getAttribute('aria-selected'), document.getElementById('navGeral').getAttribute('aria-selected')]), ['navLancamentos', 'lancamentos', 'true', 'false'], 'abas principais: ArrowRight vai para "Lançamentos" (aria-selected troca)');
  await page.keyboard.press('End');
  eq(await page.evaluate(() => [document.activeElement.id, document.body.dataset.aba]), ['navMetas', 'metas'], 'abas principais: End vai para a última ("Metas e fixos")');
  eq(await page.evaluate(() => [...document.querySelectorAll('#navPrincipal [role=tab]')].map(t => t.tabIndex)), [-1, -1, -1, 0], 'abas principais: só a aba ativa fica na sequência do Tab (tabindex móvel)');
  eq(await page.evaluate(() => [document.querySelectorAll('nav[aria-label]').length, document.querySelector('nav[aria-label] [role=tablist]') !== null]), [1, true], 'o <nav> de seções continua sendo landmark e contém o tablist');
  await irPara(page, 'geral');
  await page.focus('#navMetas'); await page.keyboard.press('Home');
  await page.setViewportSize({ width: 390, height: 844 });

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
  eq(voltou.filter(([, v]) => !v).map(([n]) => n), [], 'ao fechar um modal o foco VOLTA ao botão que o abriu nos 4 fluxos testados (' + voltou.map(([n]) => n).join(', ') + '); antes: em nenhum');
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
  eq(tiposSimbolo, [], 'nenhum botão visível só com símbolo (✓ ✎ ⧉ × …) sem aria-label (antes: ' + soSimbolo.size + ' ocorrências em ' + 'vários tipos)');
  const camposLista = [...campos].sort();
  eq(camposLista, [], 'todo campo de formulário visível tem rótulo associado (<label for>, <label> envolvente ou aria-label); o placeholder deixou de ser o único nome');
  // svg e canvas
  const svgs = await page.evaluate(() => [...document.querySelectorAll('svg')].filter(s => !s.closest('[style*="display:none"]')).map(s => ({ d: window.__a11y.desc(s.parentElement), ok: s.getAttribute('aria-hidden') === 'true' || s.getAttribute('role') === 'img' || !!s.querySelector('title') })));
  eq(svgs.filter(s => !s.ok).length, 0, `os ${svgs.length} <svg> (logo da marca) são decorativos (aria-hidden="true"); antes: nenhum era`);
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
