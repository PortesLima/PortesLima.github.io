// Ajuda (ajuda.html): guarda anti-desatualização + layout + acessibilidade + entrada no app + offline.
// 1) Guarda de rótulos: todo elemento da ajuda com data-ui="Texto" tem que existir no index.html (e o texto do elemento
//    tem que ser igual ao data-ui). Se o app renomear um botão, este teste falha e diz qual trecho da ajuda corrigir.
// 2) Estrutura: âncoras do sumário, ids únicos, imagens (alt/width/height/tamanho), sem telemetria nem gravação no storage.
// 3) Navegador: sem rolagem horizontal (360/390/768/1280 × claro/escuro × 2 abas), contraste, alvos de toque, abas por teclado.
// 4) App: item "❓ Ajuda" no menu ⚙️ (sem editable-only, funciona com o teste vencido), "Voltar ao app", zero POST ao PostHog.
// 5) Offline: servidor http://localhost real + service worker; a ajuda abre sem rede e o index.html do cache NÃO é sobrescrito.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium, ok, abrir, bloquearPosthog, res } = require('./lib');
const eq = (a, b, n) => { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, A === B ? n : `${n}  [obtido ${A} | esperado ${B}]`); };

const RAIZ = path.resolve(__dirname, '..');
const AJUDA = fs.readFileSync(path.join(RAIZ, 'ajuda.html'), 'utf8');
const INDEX = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const dec = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

(async () => {
  // ================= 1. rótulos fiéis =================
  console.log('1. rótulos citados existem no app');
  const citacoes = [...AJUDA.matchAll(/<(\w+)([^>]*)\bdata-ui="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/g)];
  ok(citacoes.length >= 100, `a ajuda cita ${citacoes.length} rótulos com data-ui (≥ 100)`);
  const faltam = [], diferem = [];
  for(const m of citacoes){
    const rotulo = dec(m[3]);
    const texto = dec(m[4].replace(/<[^>]+>/g, ''));
    if(texto !== rotulo) diferem.push(`${rotulo} ≠ ${texto}`);
    if(!INDEX.includes(rotulo)) faltam.push(rotulo);
  }
  eq(faltam, [], 'TODO rótulo citado (data-ui) existe no index.html — se falhar, corrija o trecho da ajuda ou o rótulo');
  eq(diferem, [], 'o texto de cada citação é igual ao data-ui (o teste cobre o que o leitor vê)');
  // citação de rótulo SEM data-ui: texto entre aspas curvas “…” com cara de botão não é checado; o guarda cobre só o marcado.

  // ================= 2. estrutura (sem navegador) =================
  console.log('2. estrutura');
  const ids = [...AJUDA.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  eq(ids.filter((x, i) => ids.indexOf(x) !== i), [], 'ids únicos');
  const ancoras = [...AJUDA.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
  eq([...new Set(ancoras)].filter(a => !ids.includes(a)), [], `as ${ancoras.length} âncoras apontam para um id existente`);
  const tarefas = ['instalar', 'primeiros-passos', 'gasto-rapido', 'conta-pagar', 'parcelar', 'conta-fixa', 'cartao', 'transferir', 'importar-extrato', 'orcamento', 'meta', 'categoria', 'avisos', 'drive', 'backup', 'relatorios', 'link-leitura', 'pin', 'assinatura'];
  eq(tarefas.filter(t => !ids.includes('tarefa-' + t)), [], 'as 19 tarefas do passo a passo existem');
  eq(['estrutura', 'visao-geral', 'lancamentos', 'orcamento', 'metas', 'contas', 'categorias', 'avisos', 'backup', 'assinatura', 'privacidade'].filter(t => !ids.includes('manual-' + t)).concat(['glossario', 'faq'].filter(t => !ids.includes(t))), [], 'os capítulos do manual, o glossário e as perguntas frequentes existem');
  const passos = [...AJUDA.matchAll(/<article id="tarefa-[^>]*>([\s\S]*?)<\/article>/g)].map(m => (m[1].match(/<ol>[\s\S]*?<\/ol>/g) || []).reduce((n, o) => n + o.split('<li>').length - 1, 0));
  ok(passos.every(n => n >= 3 && n <= 8), `cada tarefa tem de 3 a 8 passos numerados (${passos.join(',')})`);
  ok(/Resultado esperado/.test(AJUDA) && (AJUDA.match(/Resultado esperado/g) || []).length >= 19 && (AJUDA.match(/Se não funcionar/g) || []).length >= 18, 'tarefas têm "Resultado esperado" e "Se não funcionar"');
  eq((AJUDA.match(/<h1[ >]/g) || []).length, 1, 'um só <h1>');
  ok(/<html lang="pt-BR">/.test(AJUDA) && /<title>[^<]{4,}<\/title>/.test(AJUDA) && /<main\b/.test(AJUDA) && /<header\b/.test(AJUDA), 'lang pt-BR, <title>, <main> e <header>');
  ok(/ATUALIZAR quando a Fase 2/.test(AJUDA), 'a seção de assinatura carrega o comentário ATUALIZAR para a Fase 2');
  ok(!/<script[^>]+src=/i.test(AJUDA) && !/posthog|fetch\(|XMLHttpRequest|setItem|sendBeacon/i.test(AJUDA), 'sem script externo, sem telemetria e sem gravação (só lê o tema)');
  ok(/Coletamos apenas dados de uso anônimos e agregados|dados de uso anônimos e agregados/.test(AJUDA) && !/não coletamos nada/i.test(AJUDA), 'privacidade: mesma formulação do onboarding, nunca "não coletamos nada"');
  const imgs = [...AJUDA.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
  ok(imgs.length >= 10 && imgs.length <= 14, `${imgs.length} imagens (10 a 14)`);
  eq(imgs.filter(t => !/\balt="[^"]{12,}"/.test(t) || !/\bwidth="\d+"/.test(t) || !/\bheight="\d+"/.test(t) || !/loading="lazy"/.test(t)), [], 'toda imagem tem alt descritivo, width, height e loading=lazy');
  let total = 0, grandes = [], semArquivo = [], dimsErradas = [];
  const dims = JSON.parse(fs.readFileSync(path.join(RAIZ, 'ajuda', 'img', 'dimensoes.json'), 'utf8'));
  for(const t of imgs){
    const src = t.match(/src="([^"]+)"/)[1], f = path.join(RAIZ, src);
    if(!fs.existsSync(f)){ semArquivo.push(src); continue; }
    const b = fs.statSync(f).size; total += b; if(b > 60 * 1024) grandes.push(src);
    const nome = path.basename(src, '.webp'), w = +t.match(/width="(\d+)"/)[1], h = +t.match(/height="(\d+)"/)[1];
    if(!dims[nome] || dims[nome][0] !== w || dims[nome][1] !== h) dimsErradas.push(nome);
  }
  eq(semArquivo, [], 'todas as imagens existem em disco');
  eq(grandes, [], 'cada imagem tem ≤ 60 KB');
  ok(total <= 700 * 1024, `total das imagens ${Math.round(total / 1024)} KB ≤ 700 KB`);
  eq(dimsErradas, [], 'width/height do HTML batem com o tamanho real das capturas (sem salto de layout)');
  const sw = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
  ok(/'\.\/ajuda\.html'/.test(sw) && imgs.every(t => sw.includes("'./" + t.match(/src="([^"]+)"/)[1] + "'")), 'o service worker faz precache de ajuda.html e das imagens');
  ok(/btnAjuda/.test(INDEX) && /abrirAjuda\(\)/.test(INDEX), 'index.html tem o item de menu e a função abrirAjuda');
  const itemMenu = INDEX.match(/<button id="btnAjuda"[^>]*>[^<]*<\/button>/)[0];
  ok(!/editable-only/.test(itemMenu) && /❓ Ajuda/.test(itemMenu), 'o item "❓ Ajuda" NÃO tem a classe editable-only');

  const browser = await chromium.launch({ channel: 'msedge' });
  const FILE_AJUDA = require('url').pathToFileURL(path.join(RAIZ, 'ajuda.html')).href;
  const novaPagina = async (vp, tema, hash = '') => {
    const ctx = await browser.newContext({ viewport: vp, timezoneId: 'America/Sao_Paulo' });
    await bloquearPosthog(ctx);
    const page = await ctx.newPage();
    page.__erros = [];
    page.on('pageerror', e => page.__erros.push('pageerror: ' + e.message));
    page.on('console', m => { if(m.type() === 'error') page.__erros.push('console: ' + m.text()); });
    await page.addInitScript((t) => { try{ localStorage.setItem('bc_tema', JSON.stringify(t)); }catch(e){} }, tema);
    await page.goto(FILE_AJUDA + hash, { waitUntil: 'load' });
    return { ctx, page };
  };

  // ================= 3. layout =================
  console.log('3. sem rolagem horizontal, contraste, alvos e teclado');
  for(const w of [360, 390, 768, 1280]){
    for(const tema of ['dark', 'light']){
      const { ctx, page } = await novaPagina({ width: w, height: 800 }, tema);
      const temaAplicado = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      for(const aba of ['#aba-manual', '#aba-passo']){
        await page.click(aba);
        // carrega as imagens lazy: rola até o fim
        await page.evaluate(async () => { for(let y = 0; y < document.body.scrollHeight; y += 700){ window.scrollTo(0, y); await new Promise(r => setTimeout(r, 15)); } window.scrollTo(0, 0); });
        const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        ok(r.sw <= r.cw, `${w}px · ${tema} · ${aba === '#aba-manual' ? 'Manual' : 'Passo a passo'}: sem rolagem horizontal (${r.sw} ≤ ${r.cw})`);
      }
      eq(temaAplicado, tema, `${w}px · ${tema}: a ajuda lê o tema salvo pelo app (bc_tema)`);
      eq(page.__erros, [], `${w}px · ${tema}: sem erro de console/página`);
      await ctx.close();
    }
  }

  // contraste (texto ≥ 4,5:1) nos 2 temas, nas 2 abas, a 390 px
  for(const tema of ['dark', 'light']){
    const { ctx, page } = await novaPagina({ width: 390, height: 800 }, tema);
    for(const aba of ['#aba-manual', '#aba-passo']){
      await page.click(aba);
      // abre as perguntas (details) para medir também o texto delas
      await page.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
      const r = await page.evaluate(() => {
        const parse = s => { const m = s.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
        const mistura = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
        const fundo = (el) => {
          const cadeia = []; for(let e = el; e; e = e.parentElement) cadeia.push(parse(getComputedStyle(e).backgroundColor));
          let base = { r: 255, g: 255, b: 255, a: 1 };
          for(let i = cadeia.length - 1; i >= 0; i--) base = mistura(cadeia[i], base);
          return base;
        };
        const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
        const razao = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
        const pior = []; let n = 0;
        document.querySelectorAll('#conteudo [role=tab], #conteudo p, #conteudo li, #conteudo dt, #conteudo dd, #conteudo summary, #conteudo h2, #conteudo h3, #conteudo figcaption, #conteudo a, #conteudo b[data-ui], header h1, header .sub, header a, .topo-btn').forEach(el => {
          if(!el.getClientRects().length) return;
          const tem = [...el.childNodes].some(c => c.nodeType === 3 && c.textContent.trim());
          if(!tem) return;
          n++;
          const fg = parse(getComputedStyle(el).color), bg = fundo(el), rz = razao(mistura(fg, bg), bg);
          if(rz < 4.5) pior.push(el.tagName + ' "' + el.textContent.trim().slice(0, 30) + '" ' + rz.toFixed(2));
        });
        return { n, pior: pior.slice(0, 6) };
      });
      eq(r.pior, [], `${tema} · ${aba === '#aba-manual' ? 'Manual' : 'Passo a passo'}: contraste de texto ≥ 4,5:1 em ${r.n} elementos`);
    }
    await ctx.close();
  }

  {
    const { ctx, page } = await novaPagina({ width: 390, height: 800 }, 'dark');
    // alvos de toque ≥ 44 px (controles; links dentro de frase são isentos)
    for(const aba of ['#aba-manual', '#aba-passo']){
      await page.click(aba);
      const peq = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('[role=tab], header a.voltar, .sumario a, summary, .topo-btn, .rodape-links a').forEach(el => {
          if(!el.getClientRects().length) return;
          const r = el.getBoundingClientRect();
          if(r.height < 43.5 || r.width < 43.5) out.push(el.tagName + ' "' + el.textContent.trim().slice(0, 24) + '" ' + Math.round(r.width) + 'x' + Math.round(r.height));
        });
        return out;
      });
      eq(peq, [], `alvos de toque ≥ 44×44 no celular (${aba === '#aba-manual' ? 'Manual' : 'Passo a passo'})`);
    }
    // abas por teclado
    await page.click('#aba-manual'); await page.focus('#aba-manual');
    await page.keyboard.press('ArrowRight');
    let e = await page.evaluate(() => ({ foco: document.activeElement.id, sel: document.getElementById('aba-passo').getAttribute('aria-selected'), manualOculto: document.getElementById('manual').hidden, passoOculto: document.getElementById('passo-a-passo').hidden, tabindex: [document.getElementById('aba-manual').tabIndex, document.getElementById('aba-passo').tabIndex] }));
    eq(e, { foco: 'aba-passo', sel: 'true', manualOculto: true, passoOculto: false, tabindex: [-1, 0] }, '→ move e ATIVA "Passo a passo" (foco, aria-selected, painel, tabindex móvel)');
    await page.keyboard.press('Home');
    e = await page.evaluate(() => ({ foco: document.activeElement.id, manualOculto: document.getElementById('manual').hidden }));
    eq(e, { foco: 'aba-manual', manualOculto: false }, 'Home volta ao "Manual"');
    await page.keyboard.press('End');
    eq(await page.evaluate(() => document.activeElement.id), 'aba-passo', 'End vai ao "Passo a passo"');
    // foco visível
    await page.keyboard.press('Tab');
    const fv = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { w: cs.outlineWidth, st: cs.outlineStyle }; });
    ok(fv.st !== 'none' && parseFloat(fv.w) >= 2, `foco visível pelo Tab (outline ${fv.w} ${fv.st})`);
    // sumário clica numa tarefa → o painel certo abre
    await page.click('#aba-manual');
    await page.evaluate(() => { location.hash = '#tarefa-importar-extrato'; });
    await page.waitForFunction(() => !document.getElementById('passo-a-passo').hidden, null, { timeout: 2000 });
    e = await page.evaluate(() => ({ sel: document.getElementById('aba-passo').getAttribute('aria-selected'), visivel: document.getElementById('tarefa-importar-extrato').getClientRects().length > 0 }));
    eq(e, { sel: 'true', visivel: true }, 'link para uma tarefa abre a aba "Passo a passo" e mostra a tarefa');
    // cada âncora do sumário leva a um elemento visível
    const mortas = await page.evaluate(() => {
      const out = [];
      const ativa = (i) => document.getElementById(i ? 'aba-passo' : 'aba-manual').click();
      [0, 1].forEach(i => { ativa(i); document.querySelectorAll('.sumario a[href^="#"]').forEach(a => { const el = document.getElementById(a.getAttribute('href').slice(1)); if(el && el.getClientRects().length) return; if(!el) out.push(a.getAttribute('href')); }); });
      return out;
    });
    eq(mortas, [], 'nenhum link do sumário aponta para o vazio');
    // sem JavaScript: as duas partes aparecem
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 800 }, javaScriptEnabled: false });
    const p2 = await ctx2.newPage(); await p2.goto(FILE_AJUDA);
    const vis = await p2.locator('#manual').isVisible() && await p2.locator('#passo-a-passo').isVisible() && !(await p2.locator('#abas').isVisible());
    ok(vis, 'sem JavaScript: Manual e Passo a passo aparecem uma depois da outra e as abas ficam escondidas');
    await ctx2.close();
    // movimento reduzido: sem rolagem animada
    const ctx3 = await browser.newContext({ viewport: { width: 390, height: 800 }, reducedMotion: 'reduce' });
    const p3 = await ctx3.newPage(); await p3.goto(FILE_AJUDA);
    eq(await p3.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto', 'prefers-reduced-motion: sem rolagem suave');
    await ctx3.close();
    await ctx.close();
  }

  // ================= 4. entrada no app =================
  console.log('4. entrada pelo menu ⚙️');
  {
    const { ctx, page } = await abrir(browser, { vp: { width: 390, height: 844 } });
    await page.click('#btnConfig');
    const item = page.locator('#btnAjuda');
    eq(await item.isVisible(), true, 'o item "❓ Ajuda" aparece no menu ⚙️');
    eq(await item.evaluate(el => el.classList.contains('editable-only')), false, 'sem a classe editable-only');
    const nome = (await item.getAttribute('aria-label')) || (await item.textContent());
    ok(/Ajuda/.test(nome), 'nome acessível "Ajuda"');
    const posthog = [];
    ctx.on('request', r => { if(/posthog\.com/.test(r.url())) posthog.push(r.method() + ' ' + r.url()); });
    await Promise.all([page.waitForURL(/ajuda\.html/), item.click()]);
    await page.waitForSelector('h1');
    eq(await page.locator('h1').innerText(), 'Ajuda do Bolso Certo', 'clicar abre a ajuda');
    await page.click('#aba-passo'); await page.click('#aba-manual');
    eq(posthog, [], 'nenhuma requisição ao PostHog ao abrir e navegar pela ajuda');
    await Promise.all([page.waitForURL(/index\.html/), page.locator('header a.voltar').click()]);
    await page.waitForSelector('#conteudoApp');
    ok(/index\.html/.test(page.url()), '"← Voltar ao app" volta ao app');
    await ctx.close();
  }
  {
    // teste vencido (modo somente leitura): o item continua lá e abre
    const { ctx, page } = await abrir(browser, { vp: { width: 390, height: 844 }, fixed: '2026-09-10T12:00:00-03:00',
      init: () => { localStorage.setItem('bc_assinatura', JSON.stringify({ status: 'trial', trialInicio: '2026-08-01', assinouEm: null })); } });
    const bloqueado = await page.evaluate(() => document.body.classList.contains('readonly'));
    ok(bloqueado, 'pré-condição: teste vencido (body.readonly)');
    await page.evaluate(() => continuarSoConsultando());   // fecha o aviso "Seu teste de 15 dias terminou" (como o usuário faria)
    await page.click('#btnConfig');
    eq(await page.locator('#btnAjuda').isVisible(), true, 'com o teste vencido o item "❓ Ajuda" continua visível');
    await Promise.all([page.waitForURL(/ajuda\.html/), page.locator('#btnAjuda').click()]);
    ok(/ajuda\.html/.test(page.url()), 'e abre a ajuda');
    await ctx.close();
  }
  {
    // onboarding passo 3: link discreto "Precisa de ajuda?"
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, timezoneId: 'America/Sao_Paulo' });
    await bloquearPosthog(ctx);
    const page = await ctx.newPage();
    await page.goto(require('url').pathToFileURL(path.join(RAIZ, 'index.html')).href + '?v=1');
    await page.locator('#btnEntrarApp').click();
    await page.fill('#onbContaNome', 'Nubank');
    await page.click('text=Adicionar e continuar');
    await page.click('#modalRapido .iconbtn');   // passo 2: fecha o registro rápido pelo × (o guia segue para o passo 3)
    await page.waitForSelector('text=Pronto — você já está usando');
    const link = page.locator('.onb-ajuda a');
    eq(await link.innerText(), 'Precisa de ajuda?', 'passo 3 do onboarding tem o link "Precisa de ajuda?"');
    const caixa = await link.boundingBox();
    ok(caixa && caixa.height >= 28, 'o link é tocável');
    const sc = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    ok(sc, 'sem rolagem horizontal a 360 px com o link');
    eq(await link.getAttribute('target'), '_blank', 'abre em outra aba (o onboarding não é perdido)');
    await ctx.close();
  }

  // ================= 5. offline =================
  console.log('5. offline com service worker');
  const cenarios = [
    { nome: 'normal', f404: [] },
    { nome: 'UMA captura da ajuda com 404', f404: ['/ajuda/img/orcamento.webp'] },
  ];
  for(const cen of cenarios){
    const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.webp': 'image/webp', '.json': 'application/json' };
    const srv = http.createServer((req, resp) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if(p === '/') p = '/index.html';
      const f = path.join(RAIZ, p);
      if(cen.f404.includes(p) || !f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ resp.writeHead(404); return resp.end('nao'); }
      resp.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(resp);
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const base = 'http://localhost:' + srv.address().port;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await bloquearPosthog(ctx);
    // CDNs (Chart.js, jsPDF, Google) não existem aqui: responde vazio para não gerar ruído
    await ctx.route(/cdnjs\.cloudflare\.com|accounts\.google\.com/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    const page = await ctx.newPage();
    await page.addInitScript(() => { try{ localStorage.setItem('bc_onboardingVisto', 'true'); }catch(e){} });
    await page.goto(base + '/?v=1');
    await page.evaluate(() => navigator.serviceWorker.ready);   // não trava: a instalação PRECISA concluir mesmo com a captura em 404
    await page.waitForFunction(async () => (await caches.keys()).length > 0 && await caches.match('./ajuda.html') !== undefined, null, { timeout: 10000 });
    const pre = await page.evaluate(async () => ({ ajuda: !!(await caches.match('./ajuda.html')), img: !!(await caches.match('./ajuda/img/visao-geral.webp')), idx: !!(await caches.match('./index.html')), orc: !!(await caches.match('./ajuda/img/orcamento.webp')) }));
    eq(pre, { ajuda: true, img: true, idx: true, orc: cen.f404.length === 0 }, `[${cen.nome}] precache: o service worker INSTALA; index.html, ajuda.html e as capturas boas entram no cache${cen.f404.length ? ' (a captura em 404 só fica de fora)' : ''}`);
    // garante controle do SW (clients.claim) antes de cortar a rede
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
    await page.goto(base + '/ajuda.html');          // online: a ajuda também reabastece o cache dela
    await page.waitForSelector('h1');
    await ctx.setOffline(true);
    await page.goto(base + '/ajuda.html');
    eq(await page.locator('h1').innerText(), 'Ajuda do Bolso Certo', `[${cen.nome}] OFFLINE: a ajuda abre`);
    await page.evaluate(async () => { for(let y = 0; y < document.body.scrollHeight; y += 400){ window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } });
    await page.waitForFunction(() => [...document.images].filter(i => i.getClientRects().length).every(i => i.complete), null, { timeout: 5000 }).catch(() => {});
    const quebradas = await page.evaluate(() => [...document.images].filter(i => i.getClientRects().length && !(i.complete && i.naturalWidth > 0)).map(i => i.getAttribute('src')));
    eq(quebradas, cen.f404.map(p => p.slice(1)), `[${cen.nome}] OFFLINE: as capturas carregam${cen.f404.length ? ' (só a que deu 404 falta)' : ''}`);
    await page.goto(base + '/');
    await page.waitForSelector('#telaInicial, #conteudoApp', { state: 'attached' });
    const titulo = await page.evaluate(() => document.title + '|' + !!document.getElementById('btnConfig'));
    eq(titulo, 'Bolso Certo|true', `[${cen.nome}] OFFLINE: o app abre e abrir a ajuda NÃO sobrescreveu o index.html no cache`);
    await ctx.setOffline(false);
    await ctx.close(); srv.close();
  }
  {
    // arquivo OBRIGATÓRIO faltando (ajuda.html em 404): a instalação falha por inteiro (nada pela metade no cache)
    const srv = http.createServer((req, resp) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if(p === '/') p = '/index.html';
      const f = path.join(RAIZ, p);
      if(p === '/ajuda.html' || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ resp.writeHead(404); return resp.end('nao'); }
      resp.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(resp);
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await bloquearPosthog(ctx);
    await ctx.route(/cdnjs\.cloudflare\.com|accounts\.google\.com/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    const page = await ctx.newPage();
    await page.addInitScript(() => { try{ localStorage.setItem('bc_onboardingVisto', 'true'); }catch(e){} });
    await page.goto('http://localhost:' + srv.address().port + '/?v=1');
    await page.waitForTimeout(2500);
    const st = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); const k = await caches.keys(); let n = 0; for(const c of k) n += (await (await caches.open(c)).keys()).length; return { ativo: !!(r && r.active), itens: n }; });
    eq(st, { ativo: false, itens: 0 }, 'arquivo OBRIGATÓRIO em 404 (ajuda.html): o service worker não instala e o cache fica vazio (sem meia instalação)');
    await ctx.close(); srv.close();
  }

  await browser.close();
  const r = res();
  console.log(`\n${r.pass} ok, ${r.fail} fail`);
  process.exit(r.fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
