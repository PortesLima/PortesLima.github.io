// Auxiliares do Bloco 6 (acessibilidade e responsividade). O código abaixo roda DENTRO da página
// (injetado como string em window.__a11y) e só LÊ o DOM/estilos computados — nada é alterado.
// Usado por test-a11y.js e test-responsivo.js.
const HELPERS = `(function(){
  const A = {};
  // true quando não há animação FINITA em andamento (fade das abas, tween) — evita medir opacidade pela metade
  A.quieto = () => document.getAnimations().filter(a => { const t = a.effect && a.effect.getComputedTiming(); return t && t.iterations !== Infinity; }).every(a => a.playState === 'finished' || a.playState === 'idle');
  // ---------- visibilidade ----------
  A.visivel = (el) => {
    if(!el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if(r.width <= 0 || r.height <= 0) return false;
    for(let e = el; e && e.nodeType === 1; e = e.parentElement){
      const cs = getComputedStyle(e);
      if(cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if(e.hasAttribute('hidden') && cs.display === 'none') return false;
    }
    return true;
  };
  A.desc = (el) => {
    let s = el.tagName.toLowerCase();
    if(el.id) s += '#' + el.id;
    else if(el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
    const t = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim().slice(0, 28);
    return s + (t ? ' "' + t + '"' : '');
  };
  // ---------- contraste WCAG ----------
  const cor = (s) => {
    const m = String(s).match(/rgba?\\(([^)]+)\\)/);
    if(!m) return null;
    const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const sobre = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  A.razao = (c1, c2) => { const a = lum(c1), b = lum(c2); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  // fundo efetivo: compõe as camadas de baixo para cima; devolve null se houver imagem/gradiente no caminho
  A.fundo = (el) => {
    const camadas = [];
    for(let e = el; e && e.nodeType === 1; e = e.parentElement){
      const cs = getComputedStyle(e);
      if(cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = cor(cs.backgroundColor);
      if(c && c.a > 0){ camadas.push(c); if(c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for(let i = camadas.length - 1; i >= 0; i--) base = sobre(camadas[i], base);
    return base;
  };
  A.opacidade = (el) => { let o = 1; for(let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  A.contraste = (raiz) => {
    const out = { medidos: 0, incertos: 0, falhas: [] };
    const alvos = [...(raiz || document.body).querySelectorAll('*')];
    for(const el of alvos){
      if(['SCRIPT', 'STYLE', 'CANVAS', 'SVG', 'PATH', 'OPTION'].includes(el.tagName.toUpperCase())) continue;
      if(el.closest('svg')) continue;
      const ehCampo = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
      const temTexto = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
      if(!temTexto && !ehCampo) continue;
      if(ehCampo && /^(checkbox|radio|hidden|file|color|range)$/.test(el.type)) continue;
      if(!ehCampo && !/[\\p{L}\\p{N}]/u.test([...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(''))) continue; // só pontuação/símbolo decorativo (ex.: "·")
      if(el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      if(!A.visivel(el)) continue;
      if(ehCampo && !el.value && el.tagName !== 'SELECT') continue; // placeholder é tratado à parte
      const cs = getComputedStyle(el);
      const fg = cor(cs.color), bg = A.fundo(el);
      if(!fg || !bg){ out.incertos++; continue; }
      const op = A.opacidade(el);
      const fgEf = sobre({ ...fg, a: fg.a * op }, bg);
      const r = A.razao(fgEf, bg);
      const px = parseFloat(cs.fontSize), negrito = parseInt(cs.fontWeight) >= 700;
      const grande = px >= 24 || (px >= 18.66 && negrito);
      const minimo = grande ? 3 : 4.5;
      out.medidos++;
      if(r < minimo) out.falhas.push({ el: A.desc(el), razao: Math.round(r * 100) / 100, minimo, px });
    }
    return out;
  };
  A.placeholders = () => {
    const out = { medidos: 0, falhas: [] };
    for(const el of document.querySelectorAll('input[placeholder], textarea[placeholder]')){
      if(!A.visivel(el) || el.value) continue;
      const cs = getComputedStyle(el, '::placeholder');
      const fg = cor(cs.color), bg = A.fundo(el);
      if(!fg || !bg) continue;
      const fgEf = sobre({ ...fg, a: fg.a * (parseFloat(cs.opacity) || 1) }, bg);
      const r = A.razao(fgEf, bg); out.medidos++;
      if(r < 4.5) out.falhas.push({ el: A.desc(el), razao: Math.round(r * 100) / 100 });
    }
    return out;
  };
  // ---------- alvos de toque ----------
  A.alvos = (min) => {
    const out = { medidos: 0, falhas: [] };
    const seletor = 'button, a[href], select, input:not([type=hidden]), textarea, [role=button], [role=tab], summary, label.chk';
    for(const el of document.querySelectorAll(seletor)){
      if(!A.visivel(el)) continue;
      if(el.disabled) continue;
      let alvo = el;
      // checkbox/radio dentro de <label>: o alvo é a label
      if(/^(checkbox|radio)$/.test(el.type)){ const l = el.closest('label'); if(l) alvo = l; }
      if(el.tagName === 'LABEL' && !el.querySelector('input,select,textarea')) continue;
      // link/botão embutido numa frase: isento (WCAG 2.5.8 — alvo em linha)
      const pai = el.parentElement;
      const emLinha = el.matches('a, [role=button]') && getComputedStyle(el).display === 'inline';
      if(emLinha) continue;
      const r = alvo.getBoundingClientRect();
      out.medidos++;
      if(r.width < min - 0.5 || r.height < min - 0.5) out.falhas.push({ el: A.desc(alvo), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out;
  };
  // ---------- nomes acessíveis ----------
  A.nome = (el) => {
    const al = el.getAttribute('aria-label'); if(al && al.trim()) return al.trim();
    const lb = el.getAttribute('aria-labelledby');
    if(lb){ const t = lb.split(/\\s+/).map(i => (document.getElementById(i) || {}).textContent || '').join(' ').trim(); if(t) return t; }
    if(el.labels && el.labels.length){ const t = [...el.labels].map(l => l.textContent).join(' ').trim(); if(t) return t; }
    const tx = (el.textContent || '').replace(/\\s+/g, ' ').trim(); if(tx) return tx;
    const ti = el.getAttribute('title'); if(ti && ti.trim()) return ti.trim();
    return '';
  };
  A.botoesSemNome = () => {
    const out = { medidos: 0, vazios: [], soSimbolo: [], soTitle: [] };
    for(const el of document.querySelectorAll('button, [role=button], a[href], [role=tab]')){
      if(!A.visivel(el)) continue;
      out.medidos++;
      const comAria = !!((el.getAttribute('aria-label') || '').trim() || (el.getAttribute('aria-labelledby') || '').trim());
      const tx = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      const ti = (el.getAttribute('title') || '').trim();
      if(!comAria && !tx && !ti){ out.vazios.push(A.desc(el)); continue; }
      const soSimbolo = !!tx && !/[\\p{L}\\p{N}]/u.test(tx);
      if(!comAria && soSimbolo) out.soSimbolo.push(A.desc(el));
      else if(!comAria && !tx && ti) out.soTitle.push(A.desc(el));
    }
    return out;
  };
  A.camposSemRotulo = () => {
    const out = { medidos: 0, falhas: [] };
    for(const el of document.querySelectorAll('input, select, textarea')){
      if(/^(hidden|button|submit|reset)$/.test(el.type)) continue;
      if(!A.visivel(el) && !(el.type === 'file' || el.type === 'checkbox')) continue;
      if(!A.visivel(el) && el.closest('[style*="display:none"], [hidden]')) continue;
      if(!A.visivel(el)) continue;
      out.medidos++;
      const rotulo = ((el.getAttribute('aria-label') || '').trim()) || ((el.getAttribute('aria-labelledby') || '').trim()) || (el.labels && el.labels.length && [...el.labels].map(l => l.textContent).join('').trim());
      if(!rotulo) out.falhas.push({ el: A.desc(el), placeholder: el.getAttribute('placeholder') || null, title: el.getAttribute('title') || null });
    }
    return out;
  };
  // ---------- layout ----------
  A.overflowX = () => {
    const de = document.documentElement, b = document.body;
    const larg = de.clientWidth;
    const cul = [];
    for(const el of document.querySelectorAll('body *')){
      if(!A.visivel(el)) continue;
      const r = el.getBoundingClientRect();
      if(r.right > larg + 1 && r.left < larg){
        // ignora quem vive dentro de um contêiner que rola/corta
        let preso = false;
        for(let p = el.parentElement; p && p !== document.body; p = p.parentElement){
          const o = getComputedStyle(p).overflowX; if(o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip'){ preso = true; break; }
        }
        if(!preso && getComputedStyle(el).position !== 'fixed') cul.push(A.desc(el) + ' (direita ' + Math.round(r.right) + ' > ' + larg + ')');
      }
    }
    return { scrollW: de.scrollWidth, clientW: larg, bodyScrollW: b.scrollWidth, innerW: window.innerWidth, estoura: de.scrollWidth > larg + 1 || b.scrollWidth > window.innerWidth + 1, culpados: cul.slice(0, 5), nCulpados: cul.length };
  };
  // ---------- foco ----------
  A.indicadorFoco = (el) => {
    const cs = getComputedStyle(el);
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
    const sombra = cs.boxShadow && cs.boxShadow !== 'none';
    return { outline, sombra, ok: outline || sombra };
  };
  window.__a11y = A;
})();`;
const CHEIO = {
  contas: ['Nubank', 'Outros'], saldosIniciais: { Nubank: { valor: 1000, em: '2026-09-01' } },
  transacoes: [
    { id: 1, tipo: 'gasto', desc: 'Aluguel do apartamento com um nome bem comprido para testar a quebra de linha', valor: 1900.5, categoria: 'Moradia', conta: 'Nubank', data: '2026-09-15', status: 'pendente' },
    { id: 2, tipo: 'receita', desc: 'Salário', valor: 12000, categoria: 'Receita', conta: 'Nubank', data: '2026-09-02', status: 'pago' },
    { id: 3, tipo: 'gasto', desc: 'Mercado', valor: 120, categoria: 'Alimentação', conta: 'Nubank', data: '2026-09-03', status: 'pago' },
    { id: 4, tipo: 'gasto', desc: 'Conta vencida', valor: 80, categoria: 'Outros', conta: 'Nubank', data: '2026-09-01', status: 'pendente' },
    { id: 5, tipo: 'gasto', desc: 'Parcela (1/3)', valor: 99999.99, categoria: 'Outros', conta: 'Nubank', data: '2026-09-04', status: 'pendente', grupoParcela: 'g' },
    { id: 6, tipo: 'gasto', desc: 'Mês anterior', valor: 300, categoria: 'Lazer', conta: 'Nubank', data: '2026-08-04', status: 'pago' },
  ],
  orcamentos: { Alimentação: 130, Moradia: 2000 },
  metas: [{ id: 1, nome: 'Viagem para um lugar com nome muito comprido', valorAlvo: 50000, valorAtual: 12000, prazo: '2027-06-01' }],
  recorrentes: [{ id: 5, tipo: 'gasto', desc: 'Internet', valor: 100, categoria: 'Moradia' }],
  contasDetalhes: { Nubank: { tipo: 'cartao', diaFechamento: 25, diaVencimento: 5 } },
  assinatura: { status: 'trial', trialInicio: '2026-08-29', assinouEm: null }, // faltam 4 dias → barra urgente
};
const preparar = (page, estado) => page.evaluate(async ([estado, cheio]) => {
  if(estado === 'cheio'){
    contas = cheio.contas; saldosIniciais = cheio.saldosIniciais; transacoes = cheio.transacoes; orcamentos = cheio.orcamentos;
    metas = cheio.metas; recorrentes = cheio.recorrentes; contasDetalhes = cheio.contasDetalhes; assinatura = { ...cheio.assinatura };
    await salvarTx(); await salvarOrc(); await salvarMetas(); await salvarRec(); await salvarContas();
    avaliarAssinatura(); mostrarFaixaAtualizar(); // 3 barras: trial + "nova versão" + vencimentos (conta vencida)
  }else{
    transacoes = []; orcamentos = {}; metas = []; recorrentes = []; contasDetalhes = {}; saldosIniciais = {};
    contas = ['Conta corrente', 'Cartão de crédito', 'Dinheiro', 'Outros']; assinatura = { status: 'trial', trialInicio: '2026-09-10', assinouEm: null };
    await salvarTx(); await salvarOrc(); await salvarMetas(); await salvarRec(); await salvarContas();
    avaliarAssinatura(); document.getElementById('barraAtualizar').style.display = 'none';
  }
  popularSelectsEstaticos(); popularSeletorMes(); mesAtual = '2026-09'; document.getElementById('mesSel').value = '2026-09'; render();
}, [estado, CHEIO]);

const MODAIS = {
  modalContas: () => abrirModalContas(),
  modalCategorias: () => abrirModalCategorias(),
  modalAvisos: () => abrirModalAvisos(),
  modalRapido: () => abrirModalRapido(),
  modalPlanos: () => abrirPlanos(),
  modalAssinatura: () => abrirMinhaAssinatura(),
  modalDriveConflito: () => { document.getElementById('modalDriveConflito').style.display = 'flex'; },
  modalTrialFim: () => { document.getElementById('modalTrialFim').style.display = 'flex'; },
  modalExcluirParcela: () => { document.getElementById('modalExcluirParcelaTexto').textContent = '"Parcela (1/3)" faz parte de um parcelamento com 3 parcela(s). O que deseja excluir?'; document.getElementById('modalExcluirParcela').style.display = 'flex'; },
  modalEvolucaoMeta: () => verEvolucaoMeta(1),
  modalImportar: () => {
    importacaoPendente = { conta: 'Nubank', formato: 'ofx', jaImportados: 1, itens: [
      { nova: { data: '2026-09-05', desc: 'Compra com descrição muito comprida vinda do extrato do banco para forçar a quebra', valor: -45.9, fitid: 'A' }, status: 'nova', marcado: true, categoria: 'Outros' },
      { nova: { data: '2026-09-06', desc: 'Possível duplicata', valor: -10, fitid: 'B' }, status: 'suspeita', existente: { id: 1, data: '2026-09-05', desc: 'Já existente', valor: 10, tipo: 'gasto' }, marcado: false, categoria: 'Outros' },
    ] };
    document.getElementById('modalImportar').style.display = 'flex'; renderModalImportar();
  },
  modalOnboarding: () => { onbAtivo = true; onbPasso = 1; renderOnboarding(); document.getElementById('modalOnboarding').style.display = 'flex'; },
};

const fecharTodos = (page) => page.evaluate(() => { document.querySelectorAll('.modal-bg').forEach(m => { m.style.display = 'none'; }); onbAtivo = false; importacaoPendente = null; });
module.exports = { HELPERS, CHEIO, preparar, MODAIS, fecharTodos };
