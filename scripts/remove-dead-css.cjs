const fs = require('fs');
const path = require('path');

const CSS_FILE = 'src/styles/components.css';
const css = fs.readFileSync(CSS_FILE, 'utf8');

function walk(dir, arr = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) walk(p, arr);
    else if (/\.(jsx?|html)$/.test(f)) arr.push(p);
  }
  return arr;
}
const files = walk('src').concat(['index.html']);
const allCode = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const cssRest = ['globals', 'mercado', 'navbar', 'responsive', 'sidebar']
  .map(n => fs.readFileSync(`src/styles/${n}.css`, 'utf8')).join('\n');

function isUsed(cls) {
  const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`(?:^|[\\s"'=.\\{,])${esc}(?=[\\s"'=:.\\}]|$)`, 'm');
  return rx.test(allCode) || rx.test(cssRest);
}

// Parser simples: encontra blocos top-level `seletor { ... }` respeitando aninhamento
// de chaves. Trata @media como bloco composto (aninhado), mantém intacto.
const blocks = [];
let i = 0;
let cur = '';
function skipSpacesAndComments() {
  while (i < css.length) {
    if (css[i] === '/' && css[i+1] === '*') {
      const end = css.indexOf('*/', i+2);
      i = end === -1 ? css.length : end + 2;
    } else if (/\s/.test(css[i])) {
      i++;
    } else break;
  }
}

while (i < css.length) {
  const start = i;
  // lê até encontrar `{` no nível 0
  let depth = 0;
  while (i < css.length) {
    if (css[i] === '/' && css[i+1] === '*') {
      const end = css.indexOf('*/', i+2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (css[i] === '{') { depth = 1; i++; break; }
    i++;
  }
  if (depth === 0) {
    // final do arquivo, só whitespace/comentários sobrando
    blocks.push({ kind: 'raw', text: css.slice(start, i) });
    break;
  }
  const selEnd = i - 1; // antes do {
  // Agora ler até fechar todas as {} (pode ter aninhado em @media)
  while (i < css.length && depth > 0) {
    if (css[i] === '/' && css[i+1] === '*') {
      const end = css.indexOf('*/', i+2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }
  const bodyEnd = i;
  const selectorRaw = css.slice(start, selEnd).trim();
  const body = css.slice(start, bodyEnd);
  blocks.push({ kind: 'rule', selectorRaw, body });
}

function shouldKeep(block) {
  if (block.kind !== 'rule') return true;
  const sel = block.selectorRaw;
  // Preserva @media, @keyframes, @supports, @font-face etc
  if (sel.startsWith('@')) return true;
  // Preserva seletores sem classe (ex: body, *, h1)
  if (!/\./.test(sel)) return true;
  // Um seletor pode ter múltiplos componentes separados por vírgula.
  // Mantemos TODO o bloco se AO MENOS UM componente referenciar classe usada
  // (ou não tiver classe — pode ser tag).
  const parts = sel.split(',').map(s => s.trim());
  const classNamesRx = /\.([a-zA-Z_][\w-]*)/g;
  for (const part of parts) {
    const classes = [...part.matchAll(classNamesRx)].map(m => m[1]);
    if (classes.length === 0) return true; // não tem classe → preservar
    // Se TODAS as classes nesse seletor são usadas, preservar
    if (classes.every(isUsed)) return true;
  }
  return false;
}

const kept = blocks.filter(shouldKeep);
const removed = blocks.filter(b => !shouldKeep(b));

const output = kept.map(b => b.text || b.body).join('').replace(/\n{3,}/g, '\n\n');

fs.writeFileSync(CSS_FILE, output);

console.log(`Total blocos: ${blocks.length}`);
console.log(`Preservados: ${kept.length}`);
console.log(`Removidos: ${removed.length}`);
console.log(`Tamanho: ${css.length} → ${output.length} bytes (${Math.round((1 - output.length/css.length)*100)}% menor)`);
console.log('\n--- Seletores removidos ---');
removed.forEach(b => console.log('  ' + b.selectorRaw.replace(/\s+/g, ' ').slice(0, 100)));
