// Responsividade: sem rolagem horizontal em 360/390/768/1280 nos temas claro/escuro, nas abas e nos modais;
// barra inferior e FAB (com e sem a barra de endereço do iOS, medidos por offsetTop/offsetHeight e
// visualViewport — getBoundingClientRect().bottom é pouco confiável no headless); tabela→cartões;
// reflow a 200%/400% de zoom; prefers-reduced-motion. Caracteriza o comportamento ATUAL; o que falha
// leva [BUG-CONHECIDO] no nome do check. Relógio fixo 10/09/2026 12:00 BRT, PostHog bloqueado, sem waitForTimeout.
// LIMITE: o Chromium headless NÃO reproduz <input type=date|file> do WebKit/iOS — não declarar esse item "fechado".
const { chromium, ok, abrir, res } = require('./lib');
const { HELPERS, CHEIO, preparar, MODAIS, fecharTodos: fecharTodosH } = require('./a11y-helpers');
const FIX = '2026-09-10T12:00:00-03:00';
const eq = (a, b, n) => { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, A === B ? n : `${n}  [obtido ${A} | esperado ${B}]`); };

const VPS = [[360, 740], [390, 844], [768, 1024], [1280, 800]];
const ABAS = ['geral', 'lancamentos', 'orcamento', 'metas'];
const quieto = (page) => page.waitForFunction(() => window.__a11y.quieto());
const irPara = async (page, aba, sub = 'resumo') => { await page.evaluate(([a, s]) => { mudarAbaPrincipal(a); if(a === 'geral') mudarSubAbaGeral(s); }, [aba, sub]); await quieto(page); };
const tema = (page, t) => page.evaluate(x => aplicarTema(x), t);
const overflow = (page) => page.evaluate(() => window.__a11y.overflowX());
const NOME_OVF = (o) => o.estoura ? `scrollW ${o.scrollW} > ${o.clientW}; culpados: ${o.culpados.join(' | ')}` : '';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const { page } = await abrir(browser, { fixed: FIX });
  page.on('dialog', d => d.accept());
  await page.evaluate(HELPERS);

  // ================= 1. sem rolagem horizontal: abas × tema × estado × largura =================
  console.log('1. sem rolagem horizontal — abas');
  for(const [w, h] of VPS){
    await page.setViewportSize({ width: w, height: h });
    for(const t of ['dark', 'light']){
      await tema(page, t);
      for(const estado of ['vazio', 'cheio']){
        await preparar(page, estado);
        for(const aba of ABAS){
          for(const sub of (aba === 'geral' ? ['resumo', 'analise'] : ['resumo'])){
            await irPara(page, aba, sub);
            const o = await overflow(page);
            ok(!o.estoura, `${w}px · ${t} · ${estado} · ${aba}${aba === 'geral' ? '/' + sub : ''}: sem rolagem horizontal ${NOME_OVF(o)}`);
          }
        }
      }
    }
  }

  // ================= 2. modais =================
  console.log('2. sem rolagem horizontal — modais');
  const fecharTodos = () => fecharTodosH(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await tema(page, 'dark'); await preparar(page, 'cheio'); await irPara(page, 'geral');
  eq(await page.evaluate(() => [...document.querySelectorAll('.modal-bg')].map(m => m.id).sort()), Object.keys(MODAIS).sort(), 'GUARD: a tabela de modais deste teste cobre TODOS os .modal-bg do HTML (modal novo → adicionar aqui)');
  for(const [w, h] of VPS){
    await page.setViewportSize({ width: w, height: h });
    for(const t of ['dark', 'light']){
      await tema(page, t);
      for(const [id, abrirFn] of Object.entries(MODAIS)){
        await fecharTodos();
        await page.evaluate(abrirFn);
        await quieto(page);
        const r = await page.evaluate(id => {
          const m = document.getElementById(id), box = m.querySelector('.modal-box'), b = box.getBoundingClientRect(), A = window.__a11y;
          const o = A.overflowX();
          // o próprio modal pode rolar (max-height:90vh; overflow-y:auto): só importa o horizontal
          const cul = [...box.querySelectorAll('*')].filter(e => A.visivel(e) && e.getBoundingClientRect().right > b.right + 1 && !e.closest('[style*="overflow"]')).slice(0, 3).map(A.desc);
          return { dentro: b.left >= -0.5 && b.right <= window.innerWidth + 0.5, boxW: Math.round(b.width), vw: window.innerWidth, boxH: Math.round(b.height), vh: window.innerHeight, scrollBox: box.scrollWidth - box.clientWidth, estoura: o.estoura, cul };
        }, id);
        ok(r.dentro && !r.estoura && r.scrollBox <= 1 && r.cul.length === 0, `${w}px · ${t} · ${id}: dentro da tela, sem rolagem horizontal${r.dentro && !r.estoura && r.scrollBox <= 1 && r.cul.length === 0 ? '' : ' ' + JSON.stringify(r)}`);
      }
    }
  }
  await fecharTodos();

  // ================= 3. barra inferior, FAB e barra de endereço do iOS =================
  console.log('3. barra inferior e FAB');
  await preparar(page, 'cheio'); await tema(page, 'dark');
  const medir = () => page.evaluate(() => {
    const bar = document.getElementById('navPrincipal'), fab = document.getElementById('fab'), vv = window.visualViewport;
    const csb = getComputedStyle(bar), csf = getComputedStyle(fab);
    const barFim = bar.offsetTop + bar.offsetHeight, fabFim = fab.offsetTop + fab.offsetHeight;
    return { posBar: csb.position, hBar: bar.offsetHeight, folgaBar: Math.round(vv.height - barFim), vvH: Math.round(vv.height), fabVisivel: csf.display !== 'none', fabFim: Math.round(fabFim), barTopo: bar.offsetTop, fabTopo: fab.offsetTop, abas: [...bar.querySelectorAll('.tab')].filter(t => t.getClientRects().length).length, hAbas: [...bar.querySelectorAll('.tab')].map(t => t.offsetHeight), fabH: fab.offsetHeight, fabW: fab.offsetWidth };
  });
  for(const [w, h] of VPS){
    await page.setViewportSize({ width: w, height: h });
    await irPara(page, 'geral');
    const m = await medir();
    if(w <= 1023){
      eq([m.posBar, m.abas], ['fixed', 4], `${w}px: a barra de abas é fixa e tem 4 abas`);
      ok(m.hAbas.every(x => x >= 52), `${w}px: cada aba tem ≥ 52px de altura (${m.hAbas.join('/')})`);
      const rente = await page.evaluate(() => { const e = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1); return !!(e && e.closest('#navPrincipal')); });
      eq([rente, m.folgaBar], [false, 18], `${w}px: [BUG-CONHECIDO] a barra de abas FLUTUA 18px acima da borda da tela: o style="margin-bottom:18px" inline do <nav id=navPrincipal> vence o margin:0 da media query; a faixa de 18px abaixo dela mostra (e deixa clicar) o conteúdo da página — o CLAUDE.md tratava isso como "quirk do headless", mas é real (hit-test na última linha de pixels não acha a barra). Esperado: folga 0`);
      ok(m.fabVisivel, `${w}px: o FAB está visível na Visão Geral`);
      eq(m.fabFim - m.barTopo, 3, `${w}px: [BUG-CONHECIDO] o FAB invade a barra de abas em 3px (o FAB assume uma barra rente: bottom:76px; com a barra 18px acima, os dois se tocam); esperado: FAB ≥ 4px acima da barra`);
      ok(m.fabH >= 44 && m.fabW >= 44, `${w}px: o FAB tem ≥ 44×44 (${m.fabW}×${m.fabH})`);
    }else{
      ok(m.posBar !== 'fixed', `${w}px (desktop): a barra de abas NÃO é fixa (position ${m.posBar})`);
    }
  }
  // barra de endereço do iOS: a altura visível muda (encolhe/cresce) e a barra precisa seguir o rodapé
  console.log('3b. barra de endereço do iOS (altura do viewport variando)');
  for(const alt of [844, 760, 664, 844]){
    await page.setViewportSize({ width: 390, height: alt });
    const m = await medir();
    eq([m.vvH === alt, m.folgaBar, m.fabFim > m.barTopo - 4], [true, 18, true], `viewport 390×${alt}: [BUG-CONHECIDO] com a altura visível variando (barra de endereço do iOS), a barra continua 18px acima do rodapé e o FAB a toca — a folga é constante, então o problema é o margin inline, não a barra de endereço`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // FAB some em Lançamentos (o formulário completo já está lá)
  await irPara(page, 'lancamentos');
  eq((await medir()).fabVisivel, false, 'aba Lançamentos: o FAB some (evita cobrir os campos do formulário)');
  await irPara(page, 'orcamento');
  eq((await medir()).fabVisivel, true, 'aba Orçamento: o FAB aparece');
  // FAB × últimos itens (rolando até o fim)
  for(const [w, h] of [[360, 740], [390, 844]]){
    await page.setViewportSize({ width: w, height: h });
    for(const aba of ['geral', 'orcamento', 'metas']){
      await irPara(page, aba);
      const sobrepoe = await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        const A = window.__a11y, f = document.getElementById('fab').getBoundingClientRect(), out = [];
        for(const el of document.querySelectorAll('button, a[href], input, select, textarea, [role=button]')){
          if(el.id === 'fab' || el.closest('#navPrincipal') || !A.visivel(el)) continue;
          const r = el.getBoundingClientRect();
          if(r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top) out.push(A.desc(el));
        }
        return out;
      });
      if(aba === 'metas') eq(sobrepoe, ['button "Calcular"'], `${w}px · ${aba}: [BUG-CONHECIDO] rolando até o fim, o FAB cobre o botão "Calcular" do simulador (o .wrap reserva 76px embaixo, mas o FAB sobe até ~132px); esperado: nada coberto`);
      else eq(sobrepoe, [], `${w}px · ${aba}: rolando até o fim, o FAB não cobre nenhum botão/campo`);
    }
  }
  // toast × FAB
  await page.setViewportSize({ width: 390, height: 844 });
  await irPara(page, 'geral');
  const toastFab = await page.evaluate(() => {
    mostrarToast('Teste de toast com texto razoável', { acao: 'Desfazer', onAcao: () => {} });
    const t = document.getElementById('toast').getBoundingClientRect(), f = document.getElementById('fab').getBoundingClientRect();
    return { t: [Math.round(t.top), Math.round(t.bottom)], f: [Math.round(f.top), Math.round(f.bottom)], cruza: t.bottom > f.top && t.top < f.bottom && t.right > f.left && t.left < f.right };
  });
  eq(toastFab.cruza, true, `[BUG-CONHECIDO] o toast (com "Desfazer") se sobrepõe ao FAB na Visão Geral (toast ${toastFab.t} · FAB ${toastFab.f}): ele ficou posicionado para uma barra rente; esperado: acima do FAB`);

  // ================= 4. tabela → cartões =================
  console.log('4. tabela → cartões');
  for(const [w, h, esperado] of [[360, 740, 'grid'], [390, 844, 'grid'], [768, 1024, 'table-row'], [1280, 800, 'table-row']]){
    await page.setViewportSize({ width: w, height: h });
    await irPara(page, 'lancamentos');
    const d = await page.evaluate(() => ({ tr: getComputedStyle(document.querySelector('#corpoTabela tr')).display, thead: getComputedStyle(document.querySelector('#secLancamentos table thead')).display }));
    eq(d.tr, esperado, `${w}px: linhas da tabela de lançamentos em display:${esperado}`);
  }

  // ================= 5. reflow e zoom =================
  console.log('5. zoom 200% e 400% (reflow)');
  // 200% de zoom em 1280 = 640 px CSS; 400% = 320 px CSS (WCAG 1.4.10)
  for(const [w, h, rotulo] of [[640, 400, '200% de zoom em desktop (640×400)'], [320, 256, '400% de zoom em desktop (320×256)'], [320, 568, 'viewport estreito 320×568 (iPhone SE/zoom 400%)']]){
    await page.setViewportSize({ width: w, height: h });
    for(const aba of ABAS){
      await irPara(page, aba);
      const o = await overflow(page);
      const tabsVisiveis = await page.evaluate(() => [...document.querySelectorAll('#navPrincipal .tab')].filter(t => { const r = t.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.right <= window.innerWidth + 1; }).length);
      if(w === 320 && aba === 'geral'){
        eq([o.estoura, tabsVisiveis, o.culpados.every(c => /orc-val/.test(c))], [true, 4, true], `${rotulo} · ${aba}: [BUG-CONHECIDO] a Visão Geral ESTOURA a 320px (rolagem horizontal de ${o.scrollW - 320}px): as linhas .orc-val de "Maiores gastos"/orçamento (ex.: R$ 99.999,99) não quebram nessa largura (a 360px passa); esperado: reflow sem rolagem (WCAG 1.4.10)`);
      }else{
        ok(!o.estoura && tabsVisiveis === 4, `${rotulo} · ${aba}: sem rolagem horizontal e as 4 abas continuam visíveis${o.estoura ? ' — ' + NOME_OVF(o) : ''}${tabsVisiveis !== 4 ? ' (abas visíveis: ' + tabsVisiveis + ')' : ''}`);
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const tamanhoTexto = await page.evaluate(() => {
    const el = document.querySelector('#secGeral .card'), antes = parseFloat(getComputedStyle(el).fontSize), h2 = parseFloat(getComputedStyle(document.querySelector('.card h2')).fontSize);
    document.documentElement.style.fontSize = '200%';
    const depois = parseFloat(getComputedStyle(el).fontSize), h2d = parseFloat(getComputedStyle(document.querySelector('.card h2')).fontSize);
    document.documentElement.style.fontSize = '';
    return { antes, depois, h2, h2d };
  });
  ok(true, `caracterização: o tamanho de fonte raiz (200%) ${tamanhoTexto.antes === tamanhoTexto.depois ? 'NÃO' : ''} altera o texto do app — o texto é em px (${tamanhoTexto.antes}px → ${tamanhoTexto.depois}px; título ${tamanhoTexto.h2}px → ${tamanhoTexto.h2d}px). O zoom do navegador funciona; a preferência de "tamanho de fonte" do sistema não`);

  // ================= 6. prefers-reduced-motion =================
  console.log('6. prefers-reduced-motion');
  const { page: pr } = await abrir(browser, { fixed: FIX });
  await pr.emulateMedia({ reducedMotion: 'reduce' });
  await pr.reload({ waitUntil: 'load' });
  await pr.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
  await pr.waitForFunction(() => getComputedStyle(document.getElementById('telaInicial')).display === 'none');
  await pr.evaluate(HELPERS);
  await preparar(pr, 'cheio');
  for(const aba of ['geral', 'lancamentos', 'metas', 'geral']){ await pr.evaluate(a => mudarAbaPrincipal(a), aba); }
  const anim = await pr.evaluate(() => document.getAnimations().filter(a => { const t = a.effect.getComputedTiming(); return t.iterations !== Infinity && a.playState === 'running' && t.duration > 0; }).map(a => (a.animationName || a.transitionProperty || '?') + ' em ' + (a.effect.target ? window.__a11y.desc(a.effect.target) : '?')));
  eq(anim.length > 0 && /fadeIn/.test(anim[0]), true, '[BUG-CONHECIDO] com prefers-reduced-motion: reduce o fade-in (fadeIn) das seções AINDA roda ao trocar de aba; só o tween dos números, o esqueleto e o toast respeitam; esperado: nenhuma animação');
  const smooth = await pr.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  eq(smooth, 'auto', 'com redução de movimento o scroll-behavior do documento é "auto"');
  const tween = await pr.evaluate(async () => { const el = document.getElementById('kpiGasto'); fmtValorAnimado(el, 123.45); return el.textContent; });
  ok(/123,45/.test(tween), 'com redução de movimento os números aparecem direto no valor final (sem tween)');
  eq(await pr.evaluate(() => _prefereMenosMovimento), true, 'o app detecta a preferência (prefers-reduced-motion)');
  const skel = await pr.evaluate(() => { const el = document.querySelector('.skel'); if(!el) return 'sem .skel'; return getComputedStyle(el, '::after').animationName; });
  ok(skel === 'none' || skel === 'sem .skel', `esqueleto de carregamento sem animação sob redução de movimento (animation-name: ${skel})`);
  await pr.context().close();

  // ================= 7. estrutura do documento =================
  console.log('7. documento');
  eq(await page.evaluate(() => document.documentElement.lang), 'pt-BR', '<html lang="pt-BR">');
  eq(await page.evaluate(() => { const m = document.querySelector('meta[name=viewport]').content; return /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/.test(m); }), false, 'o viewport NÃO bloqueia o zoom (sem user-scalable=no nem maximum-scale=1)');
  eq(await page.evaluate(() => document.querySelector('meta[name=viewport]').content), 'width=device-width, initial-scale=1.0', 'meta viewport: width=device-width, initial-scale=1.0');

  eq(page.__erros, [], 'nenhum erro de console/página');
  await browser.close();
  const t = res(); console.log(`\n${t.pass} ok, ${t.fail} fail`); process.exit(t.fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
