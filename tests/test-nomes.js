// Guarda de NOMES ACESSÍVEIS no código-fonte (Leva 3 · K). Lê o index.html (marcação estática E templates de JS, inclusive
// multilinha) e falha se surgir: <button> sem texto legível nem aria-label (só símbolo/emoji), <input>/<select>/<textarea>
// sem rótulo (aria-label, <label for> ou <label> envolvente) ou <svg> sem aria-hidden/role="img". Complementa o teste
// dinâmico do test-a11y (que só vê o que está visível em cada tela). Sem navegador: roda em milissegundos.
// Exceções ficam em EXCECOES, cada uma com o motivo — como no guarda do test-escape.
const fs = require('fs');
const path = require('path');
const { ok, res } = require('./lib');
const eq = (a, b, n) => { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, A === B ? n : `${n}  [obtido ${A} | esperado ${B}]`); };

const bruto = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const corpoIni = bruto.indexOf('<body');
// o <head> (meta/ícones) não tem controles; comentários (// de linha inteira e <!-- -->; NÃO os de bloco: um "image/*" num atributo engoliria código) mencionam "<select>" em prosa
const SRC0 = bruto.slice(corpoIni).replace(/^[ \t]*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
const NUL = '\u0000';

// troca cada ${ ... } (com chaves aninhadas) por NUL: assim um ">" dentro da expressão não fecha a tag por engano
function mascarar(src){
  let out = '', i = 0;
  while(i < src.length){
    if(src[i] === '$' && src[i + 1] === '{'){
      let j = i + 2, prof = 1;
      while(j < src.length && prof > 0){ if(src[j] === '{') prof++; else if(src[j] === '}') prof--; j++; }
      const interno = src.slice(i + 2, j - 1);
      // expressão com template aninhado (ex.: ${ cond ? `<button…>` : '' }): o HTML de dentro também é lido
      out += interno.includes('`') ? mascarar(interno) : NUL;
      i = j; continue;
    }
    out += src[i++];
  }
  return out;
}
const SRC = mascarar(SRC0);
const linhaDe = (pos) => SRC0.slice(0, 0).length + (bruto.slice(0, corpoIni).split('\n').length - 1) + SRC.slice(0, pos).split('\n').length;   // aproximada (a máscara só encurta linhas únicas)

const EXCECOES = [
  // [regex sobre "tag + atributos", motivo]
];
const excecao = (txt) => EXCECOES.some(([re]) => re.test(txt));

// ---- <button> ----
const semNomeBotao = [];
let nBotoes = 0;
for(const m of SRC.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){
  nBotoes++;
  const attrs = m[1], inner = m[2];
  if(/aria-label\s*=\s*"[^"]+"|aria-labelledby\s*=/.test(attrs)) continue;
  const texto = inner.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, ' ').replace(/aria-hidden/g, '');
  // texto visível com letras/dígitos = nome; só símbolo/emoji/∅ = precisa de aria-label
  const semSpansOcultos = inner.replace(/&[a-z]+;|&#\d+;/gi, ' ').replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, ' ').replace(/<[^>]*>/g, ' ');
  if(/[A-Za-zÀ-ÿ0-9]/.test(semSpansOcultos)) continue;
  if(semSpansOcultos.includes(NUL)) continue;                                      // conteúdo dinâmico (texto vindo de dados) — conferido pelo teste dinâmico
  if(excecao(m[0])) continue;
  semNomeBotao.push(`linha ~${linhaDe(m.index)}: <button${attrs.slice(0, 60).replace(/\s+/g, ' ')}> ${inner.replace(/\s+/g, ' ').slice(0, 30)}`);
}
ok(nBotoes > 80, `${nBotoes} <button> lidos no código-fonte (marcação estática + templates)`);
eq(semNomeBotao, [], 'todo <button> tem texto legível ou aria-label (nenhum só com símbolo/emoji ✓ ✎ ⧉ × 📈…)');

// ---- <input> / <select> / <textarea> ----
const semRotulo = [];
let nCampos = 0;
const idsComLabelFor = new Set([...SRC.matchAll(/<label\b[^>]*\bfor\s*=\s*"([^"]+)"/g)].map(m => m[1]));
for(const m of SRC.matchAll(/<(input|select|textarea)\b([^>]*)>/g)){
  const attrs = m[2];
  if(/type\s*=\s*"(hidden)"/.test(attrs)) continue;
  nCampos++;
  if(/aria-label\s*=\s*"[^"]+"|aria-labelledby\s*=/.test(attrs)) continue;
  const id = (attrs.match(/\bid\s*=\s*"([^"]+)"/) || [])[1];
  if(id && idsComLabelFor.has(id)) continue;
  // <label> envolvente: o último <label ...> antes do campo não foi fechado
  const antes = SRC.slice(Math.max(0, m.index - 600), m.index);
  const abre = antes.lastIndexOf('<label'), fecha = antes.lastIndexOf('</label>');
  if(abre > fecha) continue;
  if(excecao(m[0])) continue;
  semRotulo.push(`linha ~${linhaDe(m.index)}: <${m[1]}${attrs.slice(0, 70).replace(/\s+/g, ' ')}>`);
}
ok(nCampos > 40, `${nCampos} campos (input/select/textarea) lidos no código-fonte`);
eq(semRotulo, [], 'todo campo tem rótulo: aria-label, <label for> ou <label> envolvente (o placeholder não conta como nome)');

// ---- <svg> ----
const svgSemNome = [];
let nSvg = 0;
for(const m of SRC.matchAll(/<svg\b([^>]*)>/g)){
  nSvg++;
  if(/aria-hidden\s*=\s*"true"/.test(m[1]) || /role\s*=\s*"img"/.test(m[1])) continue;
  svgSemNome.push(`linha ~${linhaDe(m.index)}: <svg ${m[1].slice(0, 50).replace(/\s+/g, ' ')}>`);
}
ok(nSvg >= 3, `${nSvg} <svg> lidos`);
eq(svgSemNome, [], 'todo <svg> é decorativo (aria-hidden="true", focusable="false") ou tem role="img"');

// ---- landmarks e regiões vivas no HTML estático ----
ok(/<main\b/.test(SRC) && /<header\b/.test(SRC), 'existem <main> e <header> no código-fonte');
ok(/id="categoriaErro"[^>]*role="alert"/.test(SRC) && /id="pinErro"[^>]*role="alert"/.test(SRC), '#categoriaErro e #pinErro têm role="alert"');
ok(EXCECOES.every(e => e[0] instanceof RegExp && e[1].length > 20), `exceções declaradas: ${EXCECOES.length} (cada uma com regex e motivo)`);

res();
