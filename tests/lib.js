// Helpers compartilhados dos testes (Playwright headless sobre file://).
// Requer playwright-core: tenta o do projeto, depois o de C:/tmp/pw-check5.
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch(e){ ({ chromium } = require('C:/tmp/pw-check5/node_modules/playwright-core')); }
const FILE = require('url').pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href + '?v=1';
let pass = 0, fail = 0;
function ok(c, n){ if(c){ pass++; console.log('  ok  ' + n); } else { fail++; console.log('  FAIL ' + n); } }
// abre o app (canal msedge), relógio fixo opcional, onboarding já visto
async function abrir(browser, { fixed, vp = { width: 390, height: 800 }, init } = {}){
  const ctx = await browser.newContext({ viewport: vp, timezoneId: 'America/Sao_Paulo' });
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
module.exports = { chromium, ok, abrir, res: () => ({ pass, fail }) };
