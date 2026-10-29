// Helpers compartilhados dos testes (Playwright headless sobre file://).
// Requer playwright-core: tenta o do projeto, depois o de C:/tmp/pw-check5.
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch(e){ ({ chromium } = require('C:/tmp/pw-check5/node_modules/playwright-core')); }
const FILE = require('url').pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href + '?v=1';
let pass = 0, fail = 0;
// Nenhum teste envia nada ao PostHog real (projeto de produção). Auditoria opcional:
// BC_PH_AUDIT=<arquivo> grava uma linha por requisição a *posthog.com (BLOQ/FULFILL/PASS).
function _audit(acao, url){
  if(process.env.BC_PH_AUDIT) try{ require('fs').appendFileSync(process.env.BC_PH_AUDIT, acao + ' ' + url + '\n'); }catch(e){}
}
// resposta local vazia: JS vazio para script (.js), JSON para o resto
function _bloq(route){
  const u = route.request().url(); _audit('BLOQ', u);
  if(u.split('?')[0].endsWith('.js')) route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* bloqueado nos testes */' });
  else route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
}
// padrão de todos os testes: responde localmente (vazio) a tudo de posthog.com — nada sai pra rede.
// (abort geraria 'ERR_FAILED' no console e quebraria os checks de "sem erro de console")
async function bloquearPosthog(ctx){
  await ctx.route(/posthog\.com/, route => { _bloq(route); });
}
// testes de telemetria: deixa carregar só o SDK (GET static/array.js, CDN de assets);
// o POST de eventos (/e/) é respondido aqui com 200 e entregue a onPost(buffer) — nunca sai pra rede.
async function interceptarPosthog(ctx, onPost){
  await ctx.route(/posthog\.com/, route => {
    const r = route.request(), u = r.url();
    if(r.method() === 'GET' && u.startsWith('https://us-assets.i.posthog.com/static/array.js')){ _audit('PASS', u); return route.continue(); }
    if(r.method() === 'POST' && u.startsWith('https://us.i.posthog.com/e/')){
      _audit('FULFILL', u); if(onPost) onPost(r.postDataBuffer());
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
    }
    _bloq(route);
  });
}
function ok(c, n){ if(c){ pass++; console.log('  ok  ' + n); } else { fail++; console.log('  FAIL ' + n); } }
// abre o app (canal msedge), relógio fixo opcional, onboarding já visto
async function abrir(browser, { fixed, vp = { width: 390, height: 800 }, init } = {}){
  const ctx = await browser.newContext({ viewport: vp, timezoneId: 'America/Sao_Paulo' });
  await bloquearPosthog(ctx);
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  page.on('console', m => { if(m.type() === 'error') erros.push('console: ' + m.text()); });
  page.__erros = erros;
  if(fixed) await page.clock.setFixedTime(new Date(fixed));
  await page.addInitScript(() => { localStorage.setItem('bc_onboardingVisto', 'true'); });
  if(init) await page.addInitScript(init);
  await page.goto(FILE, { waitUntil: 'load' });
  await page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  return { ctx, page };
}
module.exports = { chromium, ok, abrir, bloquearPosthog, interceptarPosthog, res: () => ({ pass, fail }) };
