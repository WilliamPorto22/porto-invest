// Varredura: detecta chamadas de função que não aparecem como definição ou import.
// Heurística — dá falsos positivos, mas ajuda a encontrar bugs tipo "getClassTotalFicha".

const fs = require('fs');
const path = require('path');

function walk(dir, arr = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) walk(p, arr);
    else if (/\.jsx?$/.test(f) && !f.includes('.test.')) arr.push(p);
  }
  return arr;
}

const BUILTINS = new Set([
  'Math','Object','Array','String','Number','JSON','Date','Promise','Error','Set','Map','RegExp','Symbol',
  'console','document','window','navigator','localStorage','sessionStorage','fetch','setTimeout','clearTimeout',
  'setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame','requestIdleCallback',
  'addEventListener','removeEventListener','parseInt','parseFloat','isNaN','isFinite','encodeURIComponent',
  'decodeURIComponent','alert','confirm','prompt','URL','URLSearchParams','FileReader','File','Blob',
  'FormData','AbortController','AbortSignal','atob','btoa','structuredClone','crypto','Image','Boolean',
  'StrictMode','Component',
]);

const KEYWORDS = new Set(['if','for','while','switch','return','throw','typeof','new','await','yield','void','catch','function','async','do','else','in','of','case','break','continue','try','finally','default','delete','instanceof','class','extends','this','super']);

const files = walk('src');
const bySymbol = new Map();

for (const f of files) {
  let src = fs.readFileSync(f, 'utf8');
  // Remove strings, template literals, comentários
  src = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/`(?:\\`|[^`])*`/g, '""')
    .replace(/'(?:\\'|[^'])*'/g, '""')
    .replace(/"(?:\\"|[^"])*"/g, '""');

  const defined = new Set();
  [...src.matchAll(/(?:function|const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g)].forEach(m => defined.add(m[1]));
  [...src.matchAll(/import\s+(?:(\w+)|\*\s+as\s+(\w+)|\{([^}]+)\})\s+from/g)].forEach(m => {
    if (m[1]) defined.add(m[1]);
    if (m[2]) defined.add(m[2]);
    if (m[3]) m[3].split(',').forEach(n => { const x = n.trim().split(/\s+as\s+/).pop(); if (x) defined.add(x); });
  });
  // Parâmetros
  [...src.matchAll(/\(([^)]*)\)\s*=>/g)].forEach(m => m[1].split(',').forEach(p => {
    const n = p.trim().split(/[=:\s]/)[0].replace(/[{}[\]]/g,'');
    if (n) defined.add(n);
  }));
  [...src.matchAll(/function\s*\w*\s*\(([^)]*)\)/g)].forEach(m => m[1].split(',').forEach(p => {
    const n = p.trim().split(/[=:\s]/)[0].replace(/[{}[\]]/g,'');
    if (n) defined.add(n);
  }));
  // Destructuring
  [...src.matchAll(/(?:const|let|var)\s*\{([^}]+)\}/g)].forEach(m => m[1].split(',').forEach(p => {
    const parts = p.trim().split(/[=:\s]/);
    const n = parts[parts.length - 1];
    if (n) defined.add(n);
  }));
  [...src.matchAll(/(?:const|let|var)\s*\[([^\]]+)\]/g)].forEach(m => m[1].split(',').forEach(p => {
    const n = p.trim().split(/[=\s]/)[0];
    if (n) defined.add(n);
  }));

  // Chamadas: identificador seguido de ( que não seja precedido por . ou $
  const calls = [...src.matchAll(/(?:^|[^.\w$])([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map(m => m[1]);
  const uniqueCalls = [...new Set(calls)];

  for (const c of uniqueCalls) {
    if (defined.has(c) || BUILTINS.has(c) || KEYWORDS.has(c)) continue;
    if (!bySymbol.has(c)) bySymbol.set(c, new Set());
    bySymbol.get(c).add(f);
  }
}

// Filtra pra mostrar só os muito suspeitos
const suspects = [...bySymbol.entries()]
  .filter(([s, files]) => files.size <= 2)
  .filter(([s]) => !/^(on|handle|get|set|use|is|has|to|from|with)[A-Z]/.test(s))
  .filter(([s]) => s.length > 4)
  .slice(0, 80);

console.log(`Encontrados ${suspects.length} símbolos suspeitos (funções possivelmente não-definidas):\n`);
for (const [sym, files] of suspects) {
  const shortFiles = [...files].map(f => f.split(/[\\/]/).slice(-2).join('/')).join(', ');
  console.log(`  ${sym.padEnd(30)} → ${shortFiles}`);
}
