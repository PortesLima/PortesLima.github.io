// Guard de regressão: BC_PH_KEY precisa ser IGUAL à Project API Key do projeto 590622
// (PostHog US Cloud), e o token do POST real para /e/ também. Um 'J' virou '3' uma vez e a
// telemetria inteira foi descartada em silêncio por ~2 meses.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { chromium, ok, res, interceptarPosthog } = require('./lib');
const CHAVE_ESPERADA = 'phc_DjJkAukpMc3knrfxJaiUaWif8wsp5FDspttUazfqjE65';
const FILE = require('url').pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href + '?v=1';

function corpo(buf){
  let b = buf; try{ if(b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b); }catch(e){}
  let s = b.toString('utf8');
  if(/^data=/.test(s)) s = decodeURIComponent(s.slice(5));
  try{ return JSON.parse(s); }catch(e){ return null; }
}

(async () => {
  for(const arq of ['index.html', 'dashboard-financeiro.html']){
    const html = fs.readFileSync(path.resolve(__dirname, '..', arq), 'utf8');
    const m = html.match(/var BC_PH_KEY = '([^']+)'/);
    ok(m && m[1] === CHAVE_ESPERADA, `${arq}: BC_PH_KEY === chave do projeto 590622`);
  }
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' }); // UA sem "HeadlessChrome" (o SDK também filtra por UA)
  const posts = [];
  await interceptarPosthog(ctx, buf => posts.push(buf)); // POST /e/ é respondido localmente, não sai pra rede
  const page = await ctx.newPage();
  // o SDK descarta eventos de bot: mascara webdriver (e o UA, acima) só no teste
  await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const eventos = posts.flatMap(b => { const p = corpo(b); return Array.isArray(p) ? p : (p && p.batch) || (p ? [p] : []); });
  ok(posts.length > 0, 'POST para us.i.posthog.com/e/ enviado');
  ok(eventos.length > 0 && eventos.every(e => (e.api_key || (e.properties && e.properties.token)) === CHAVE_ESPERADA),
    'token de TODOS os eventos enviados === chave esperada (' + eventos.length + ' evento(s))');
  ok(eventos.some(e => e.event === 'sessao_iniciada'), 'evento sessao_iniciada enviado');
  await browser.close();
  const r = res(); console.log(`\n${r.pass} ok, ${r.fail} fail`); process.exit(r.fail ? 1 : 0);
})();
