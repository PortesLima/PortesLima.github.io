const { chromium, ok, abrir, res } = require('./lib');
const T = (id, data, extra={}) => ({ id, tipo:'gasto', desc:'Conta '+id, valor:100, categoria:'Outros', conta:'Carteira', data, status:'pendente', ...extra });
const SEED = [
  T(1,'2026-09-10'), T(2,'2026-09-11'), T(3,'2026-09-13'), T(4,'2026-09-14'),
  T(5,'2026-09-09'), T(6,'2025-01-01'),
  T(7,'2026-09-10',{tipo:'receita',categoria:'Receita'}),
  T(8,'2026-09-10',{tipo:'transferencia',subtipo:'saida',categoria:'Transferência',status:'pago'}),
  T(9,'2026-09-10',{status:'pago'}),
];
const set = (page, arr) => page.evaluate(async a => { transacoes = a; await salvarTx(); render(); }, arr);
const txt = page => page.evaluate(() => { const e=document.getElementById('barraVencimentos'); return e.style.display==='none' ? null : e.querySelector('.bv-txt').textContent.replace(/\s+/g,' ').trim(); });
const FIX = '2026-09-10T12:00:00-03:00';

(async()=>{
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  let {ctx,page} = await abrir(browser,{fixed:FIX});
  await set(page, SEED);

  console.log('1. contasParaAvisar');
  const c = await page.evaluate(() => { const r=contasParaAvisar(); return {h:r.hoje.map(t=>t.id),p:r.proximos.map(t=>t.id),a:r.atrasadas.map(t=>t.id)}; });
  ok(JSON.stringify(c.h)==='[1]','hoje = [1]');
  ok(JSON.stringify(c.p)==='[2,3]','próximos = [2,3] (09-14 fora)');
  ok(JSON.stringify(c.a)==='[6,5]','atrasadas ordenadas mais antiga primeiro, sem corte');

  console.log('2. filtro de conta');
  await page.evaluate(() => { contas.push('Outra'); });
  const antes = await page.evaluate(() => JSON.stringify(contasParaAvisar()));
  await page.evaluate(() => { const s=document.getElementById('contaFiltro'); if(s){ s.innerHTML+='<option value="Outra">Outra</option>'; s.value='Outra'; } render(); });
  ok(await page.evaluate(() => JSON.stringify(contasParaAvisar()))===antes,'resultado não muda com filtro de conta');
  await page.evaluate(() => { const s=document.getElementById('contaFiltro'); if(s){ s.value=''; } render(); });

  console.log('3/4. banner, urgente, plural');
  ok(await txt(page)==='⚠ 2 atrasadas · 1 vence hoje · 2 nos próximos 3 dias','texto com 3 segmentos');
  ok(await page.evaluate(()=>document.getElementById('barraVencimentos').classList.contains('urgente')),'urgente com atrasada/hoje');
  await page.evaluate(() => { avisosVencimento.atrasadas=false; render(); });
  ok(await txt(page)==='⚠ 1 vence hoje · 2 nos próximos 3 dias','desligar atrasadas some o segmento');
  await page.evaluate(() => { avisosVencimento.hoje=false; render(); });
  ok(await txt(page)==='2 nos próximos 3 dias','só próximos');
  ok(!(await page.evaluate(()=>document.getElementById('barraVencimentos').classList.contains('urgente'))),'neutra só com próximos');
  await page.evaluate(() => { avisosVencimento.proximos=false; render(); });
  ok(await txt(page)===null,'3 desligados -> oculto');
  await page.evaluate(() => { avisosVencimento={hoje:true,proximos:true,atrasadas:true}; render(); });
  await set(page,[T(1,'2026-09-09'),T(2,'2026-09-10'),T(3,'2026-09-12')]);
  ok(await txt(page)==='⚠ 1 atrasada · 1 vence hoje · 1 nos próximos 3 dias','singulares');

  console.log('5. marcar como pago atualiza na hora');
  await set(page, SEED);
  await page.evaluate(() => marcarComoPago(1));
  ok(await txt(page)==='⚠ 2 atrasadas · 2 nos próximos 3 dias','hoje some após marcar pago');

  console.log('6. dispensar');
  await set(page, SEED);
  await page.click('#barraVencimentos button.secondary');
  ok(await txt(page)===null,'✕ oculta');
  await page.reload({waitUntil:'load'}); await page.locator('#btnEntrarApp').click({timeout:3000}).catch(()=>{}); await page.waitForTimeout(400);
  ok(await txt(page)===null,'recarregar mesmo dia segue oculto');
  await page.evaluate(() => marcarComoPago(2));
  ok(await txt(page)===null,'marcar pago não reabre');
  await page.evaluate(() => { transacoes.push({id:99,tipo:'gasto',desc:'Nova',valor:5,categoria:'Outros',conta:'Carteira',data:'2026-09-12',status:'pendente'}); render(); });
  ok(await txt(page)!==null,'conta nova na janela reabre');
  await page.click('#barraVencimentos button.secondary');
  ok(await txt(page)===null,'dispensa de novo');
  await page.clock.setFixedTime(new Date('2026-09-11T12:00:00-03:00'));
  await page.evaluate(() => render());
  ok(await txt(page)!==null,'dia seguinte reabre');

  console.log('7. Ver');
  await set(page, SEED);
  await page.evaluate(() => { localStorage.removeItem('bc_aviso_venc_dispensado'); mudarAbaPrincipal('geral'); render(); });
  await page.click('#barraVencimentos button:not(.secondary)');
  ok(await page.evaluate(()=>visaoContas)==='pendente','Ver liga visão pendente');
  ok(await page.evaluate(()=>document.getElementById('secLancamentos').style.display)==='block','abre Lançamentos');
  await page.click('#barraVencimentos button:not(.secondary)');
  ok(await page.evaluate(()=>visaoContas)==='pendente','Ver 2x não desliga');

  console.log('8. funil');
  await page.evaluate(() => { avisosVencimento={hoje:false,proximos:true,atrasadas:false}; });
  const est = await page.evaluate(() => montarEstado());
  ok(est.avisosVencimento && est.avisosVencimento.hoje===false,'montarEstado contém avisosVencimento');
  await page.evaluate(async e => { avisosVencimento={hoje:true,proximos:true,atrasadas:true}; await aplicarDadosImportados(e); }, est);
  ok(await page.evaluate(()=>JSON.stringify(avisosVencimento))===JSON.stringify({hoje:false,proximos:true,atrasadas:false}),'ida e volta mantém preferências');
  const velho = {...est}; delete velho.avisosVencimento;
  await page.evaluate(async e => { await aplicarDadosImportados(e); }, velho);
  ok(await page.evaluate(()=>JSON.stringify(avisosVencimento))===JSON.stringify({hoje:true,proximos:true,atrasadas:true}),'blob antigo -> 3 true');
  ok(await page.evaluate(()=>JSON.stringify(normalizarAvisosVencimento({hoje:'x',proximos:false})))==='{"hoje":true,"proximos":false,"atrasadas":true}','normaliza lixo');

  console.log('9. modal');
  await page.evaluate(() => { document.getElementById('menuConfig').style.display='block'; });
  await page.click('#btnAvisos');
  ok(await page.evaluate(()=>document.getElementById('modalAvisos').style.display)==='flex','abre pelo menu');
  const alt = await page.evaluate(() => [...document.querySelectorAll('.aviso-op')].map(l=>l.getBoundingClientRect().height));
  ok(alt.length===3 && alt.every(h=>h>=44),'labels >= 44px '+alt.join(','));
  await page.click('label.aviso-op:has(#avisoAtrasadas)');
  ok(await page.evaluate(()=>avisosVencimento.atrasadas)===false,'checkbox altera estado');
  await page.waitForTimeout(100);
  await page.reload({waitUntil:'load'}); await page.locator('#btnEntrarApp').click({timeout:3000}).catch(()=>{}); await page.waitForTimeout(400);
  ok(await page.evaluate(()=>avisosVencimento.atrasadas)===false,'persiste após recarregar');
  await ctx.close();

  console.log('9b. modal em modo readonly');
  ({ctx,page} = await abrir(browser,{fixed:FIX, init:()=>{ try{ history.replaceState(null,'','?v=1&readonly=1'); }catch(e){} }}));
  await page.evaluate(() => { document.body.classList.add('readonly'); });
  await page.evaluate(() => abrirModalAvisos());
  ok(await page.evaluate(()=>document.getElementById('modalAvisos').style.display)==='flex','abre com body.readonly');
  await ctx.close();

  console.log('10. notificações');
  const mock = () => { window.__n=[]; window.Notification = function(t,o){ window.__n.push(t); }; window.Notification.permission='granted'; window.Notification.requestPermission=()=>Promise.resolve('granted'); };
  ({ctx,page} = await abrir(browser,{fixed:FIX}));
  await page.evaluate(mock);
  await set(page, SEED);
  await page.evaluate(() => verificarNotificacoesPendentes());
  ok(JSON.stringify(await page.evaluate(()=>window.__n))==='["Contas vencidas","Vence hoje","Vencem nos próximos 3 dias"]','uma por tipo');
  await page.evaluate(() => { window.__n=[]; avisosVencimento.hoje=false; avisosVencimento.proximos=false; verificarNotificacoesPendentes(); });
  ok(JSON.stringify(await page.evaluate(()=>window.__n))==='["Contas vencidas"]','respeita preferências');
  await set(page,[T(1,'2026-09-01',{tipo:'receita',categoria:'Receita'})]);
  await page.evaluate(() => { window.__n=[]; avisosVencimento={hoje:true,proximos:true,atrasadas:true}; verificarNotificacoesPendentes(); });
  ok(JSON.stringify(await page.evaluate(()=>window.__n))==='[]','receita pendente não dispara "vencida"');
  await ctx.close();
  await browser.close();
  console.log(JSON.stringify(res())); process.exit(res().fail?1:0);
})();
