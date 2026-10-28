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
const bannerTxtLocal = page => page.evaluate(() => document.querySelector('#barraVencimentos .bv-txt').textContent);
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

  console.log('7b. Ver rola até a lista (390 e 1280)');
  await ctx.close();
  for(const vp of [{width:390,height:800},{width:1280,height:800}]){
    for(const origem of ['lancamentos','geral']){
      ({ctx,page} = await abrir(browser,{fixed:FIX, vp}));
      await set(page, SEED);
      await page.evaluate(o => { mudarAbaPrincipal(o); }, origem);
      await page.waitForTimeout(700);
      await page.click('#barraVencimentos button:not(.secondary)');
      await page.waitForTimeout(1200);
      const r = await page.evaluate(() => {
        const chip = document.getElementById('chipVisaoContas');
        const el = chip.offsetParent !== null ? chip : document.getElementById('btnVisaoPendentes');
        const b = el.getBoundingClientRect();
        return { id: el.id, top: b.top, bottom: b.bottom, vh: window.innerHeight, nav: (document.getElementById('navPrincipal')||{}).offsetHeight||0 };
      });
      ok(r.top >= 0 && r.bottom <= r.vh - (vp.width<1024 ? r.nav : 0), vp.width+' de '+origem+': #'+r.id+' visível (top '+Math.round(r.top)+', vh '+r.vh+')');
      await ctx.close();
    }
  }
  ({ctx,page} = await abrir(browser,{fixed:FIX}));
  await set(page, SEED);

  console.log('7c. Ver = só o mês selecionado');
  await ctx.close();
  {
    const OUT = [T(1,'2026-10-28'), T(2,'2026-10-29'), T(3,'2026-11-01'), T(4,'2026-09-15')];
    const linhas = p => p.evaluate(() => [...document.querySelectorAll('#corpoTabela tr:not(.linha-ver-antigas)')].map(tr => tr.querySelector('.col-desc').firstChild.textContent.trim()));
    const chip = p => p.evaluate(() => document.getElementById('chipVisaoContas').textContent.replace(/\s+/g,' ').trim());
    ({ctx,page} = await abrir(browser,{fixed:'2026-10-28T12:00:00-03:00'}));
    await set(page, OUT);
    ok(await page.evaluate(()=>mesAtual)==='2026-10','mês selecionado = out/2026');
    await page.click('#barraVencimentos button:not(.secondary)');
    ok(JSON.stringify(await linhas(page))==='["Conta 1","Conta 2"]','Ver lista só as pendentes de outubro');
    let c = await chip(page);
    ok(/pendentes de out\/2026/.test(c),'chip: pendentes de out/2026 ['+c+']');
    ok(/2 de outros meses/.test(c),'chip: 2 de outros meses');
    ok(await page.evaluate(()=>contasParaAvisar().atrasadas.length)===1 && /1 atrasada/.test(await bannerTxtLocal(page)),'banner segue contando atrasada de setembro');
    await page.click('#barraVencimentos button:not(.secondary)');
    ok(await page.evaluate(()=>visaoContasMes)===true && (await linhas(page)).length===2,'Ver 2x não desliga o modo');
    await page.click('#chipVisaoContas [onclick*="alternarVisaoContas"]');
    ok(JSON.stringify(await linhas(page))==='["Conta 4","Conta 1","Conta 2","Conta 3"]','"ver todas" lista as 4 (mais antiga primeiro)');
    ok(await page.evaluate(()=>!document.getElementById('btnVisaoPendentes').classList.contains('secondary')),'botão "Ver todas pendentes" fica ativo');
    ok(/todas as pendentes/.test(await chip(page)),'chip volta ao texto "todas as pendentes"');
    // volta ao modo mês, troca o seletor pra nov/2026
    await page.evaluate(()=>verContasAvisadas());
    await page.evaluate(()=>{ const s=document.getElementById('mesSel'); s.value='2026-11'; s.dispatchEvent(new Event('change')); });
    ok(JSON.stringify(await linhas(page))==='["Conta 3"]','trocar pra nov/2026: lista só 11-01');
    c = await chip(page);
    ok(/pendentes de nov\/2026/.test(c) && /3 de outros meses/.test(c),'chip acompanha o seletor ['+c+']');
    // botão normal em modo mês amplia (não desliga); limpar + botão normal lista tudo
    await page.click('#btnVisaoPendentes');
    ok((await linhas(page)).length===4 && await page.evaluate(()=>visaoContas)==='pendente','botão com modo mês ativo amplia pra todos os meses');
    await page.evaluate(()=>limparVisaoContas());
    await page.click('#btnVisaoPendentes');
    ok((await linhas(page)).length===4 && await page.evaluate(()=>visaoContasMes)===false,'"Ver todas pendentes" normal lista todos os meses');
    await page.evaluate(()=>{ limparVisaoContas(); const s=document.getElementById('mesSel'); s.value='2026-10'; s.dispatchEvent(new Event('change')); });
    await ctx.close();
    // mês sem pendentes
    ({ctx,page} = await abrir(browser,{fixed:'2026-10-28T12:00:00-03:00'}));
    await set(page, [T(1,'2026-10-05',{status:'pago'}), T(3,'2026-11-01')]);
    await page.evaluate(()=>verContasAvisadas());
    const v = await page.evaluate(()=>{ const e=document.getElementById('vazio'); return {d:e.style.display,t:e.textContent.replace(/\s+/g,' ').trim()}; });
    ok(v.d==='block' && /Nenhuma conta pendente em out\/2026/.test(v.t) && /1 de outros meses/.test(v.t),'estado vazio do mês ['+v.t+']');
    await page.evaluate(()=>limparVisaoContas());
    ok(await page.evaluate(()=>document.getElementById('vazio').textContent)==='Nenhum lançamento encontrado.' || await page.evaluate(()=>document.getElementById('vazio').style.display)==='none','vazio volta ao texto padrão');
    await ctx.close();
  }
  ({ctx,page} = await abrir(browser,{fixed:FIX}));
  await set(page, SEED);

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
