// trial_expirado: flag novo bc_tel_expirado2 (a .22 renomeou o antigo para reenviar o evento
// de aparelhos que o perderam pela chave errada). Envia 1x ao abrir; ao reabrir, não repete.
const path = require('path'), zlib = require('zlib');
const { chromium, ok, res } = require('./lib');
const FILE = require('url').pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href + '?v=1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
function eventos(bufs){
  return bufs.flatMap(b => {
    try{ if(b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b); }catch(e){}
    let s = b.toString('utf8'); if(/^data=/.test(s)) s = decodeURIComponent(s.slice(5));
    try{ const p = JSON.parse(s); return Array.isArray(p) ? p : p.batch || [p]; }catch(e){ return []; }
  }).map(e => e.event);
}
async function abrirUmaVez(ctx){
  const page = await ctx.newPage(); const posts = [];
  page.on('request', r => { if(r.method() === 'POST' && /us\.i\.posthog\.com\/e\//.test(r.url())) posts.push(r.postDataBuffer()); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.locator('#btnEntrarApp').click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const flags = await page.evaluate(() => ({ v1: localStorage.getItem('bc_tel_expirado'), v2: localStorage.getItem('bc_tel_expirado2') }));
  await page.close();
  return { evs: eventos(posts), flags };
}
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ userAgent: UA });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    if(!localStorage.getItem('bc_semeado')){ // semeia só na 1ª abertura; reabrir usa o storage real
      localStorage.setItem('bc_semeado', '1');
      localStorage.setItem('bc_onboardingVisto', 'true');
      localStorage.setItem('bc_assinatura', JSON.stringify({ status: 'trial', trialInicio: '2026-01-01', assinouEm: null }));
      localStorage.setItem('bc_tel_expirado', '1'); // flag ANTIGO: evento perdido pela chave errada
    }
  });
  const a = await abrirUmaVez(ctx);
  ok(a.evs.filter(e => e === 'trial_expirado').length === 1, 'aparelho com flag antigo + trial expirado envia trial_expirado 1x ao abrir');
  ok(a.flags.v2 === '1', 'bc_tel_expirado2 = 1 após enviar');
  ok(!a.evs.includes('trial_iniciado'), 'trial_iniciado NÃO reenvia (trialInicio já existe)');
  const b = await abrirUmaVez(ctx);
  ok(!b.evs.includes('trial_expirado'), 'reabrir não envia trial_expirado de novo');
  ok(b.flags.v2 === '1', 'bc_tel_expirado2 continua 1');
  await browser.close();
  const r = res(); console.log(`\n${r.pass} ok, ${r.fail} fail`); process.exit(r.fail ? 1 : 0);
})();
