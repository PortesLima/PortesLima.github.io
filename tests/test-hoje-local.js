const { chromium, ok, abrir, res } = require('./lib');
(async()=>{
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  let {ctx,page} = await abrir(browser,{fixed:'2026-09-10T23:30:00-03:00'});
  ok(await page.evaluate(()=>hojeISO())==='2026-09-10','23:30 BRT -> hojeISO = 2026-09-10');
  ok(await page.evaluate(()=>statusEfetivo({tipo:'gasto',status:'pendente',data:'2026-09-10'}))==='pendente','conta de hoje às 23:30 segue pendente');
  await ctx.close();
  ({ctx,page} = await abrir(browser,{fixed:'2026-09-30T23:30:00-03:00'}));
  ok(await page.evaluate(()=>mesAtual)==='2026-09','30/09 23:30 -> mesAtual 2026-09');
  ok(await page.evaluate(()=>hojeISO())==='2026-09-30','hojeISO 2026-09-30');
  await ctx.close(); await browser.close();
  console.log(JSON.stringify(res())); process.exit(res().fail?1:0);
})();
