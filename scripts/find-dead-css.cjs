const fs = require('fs');
const path = require('path');

// Analisa cada arquivo CSS isoladamente: classes definidas em X que não são
// referenciadas em nenhum JSX/HTML nem em OUTROS arquivos CSS.
// Uso: node scripts/find-dead-css.cjs [arquivo.css]
//      (sem args) → analisa todos em src/styles/

const STYLES_DIR = 'src/styles';
const target = process.argv[2];
const cssFiles = target
  ? [target]
  : fs.readdirSync(STYLES_DIR).filter(f => f.endsWith('.css')).map(f => path.join(STYLES_DIR, f));

function walk(dir, arr = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) walk(p, arr);
    else if (/\.(jsx?|html)$/.test(f)) arr.push(p);
  }
  return arr;
}

const codeFiles = walk('src').concat(['index.html']);
const allCode = codeFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');

function isUsedIn(code, cls) {
  const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`(?:^|[\\s"'=.\\{,])${esc}(?=[\\s"'=:.\\}]|$)`, 'm');
  return rx.test(code);
}

for (const cssFile of cssFiles) {
  const css = fs.readFileSync(cssFile, 'utf8');
  const defined = new Set();
  const rx = /\.([a-zA-Z_][\w-]*)/g;
  let m;
  while ((m = rx.exec(css)) !== null) defined.add(m[1]);

  // CSS dos OUTROS arquivos — uma classe pode ser definida em A e referenciada
  // como sub-seletor em B (ex: `.sidebar .item` em sidebar.css usa `.item` definido em components)
  const otherCss = cssFiles.filter(f => f !== cssFile)
    .map(f => fs.readFileSync(f, 'utf8')).join('\n');

  const dead = [];
  const used = [];
  for (const cls of defined) {
    if (isUsedIn(allCode, cls) || isUsedIn(otherCss, cls)) used.push(cls);
    else dead.push(cls);
  }

  console.log(`\n=== ${cssFile} ===`);
  console.log(`  Definidas: ${defined.size} | Usadas: ${used.length} | Mortas: ${dead.length}`);
  if (dead.length) {
    console.log('  Classes mortas:');
    dead.sort().forEach(c => console.log('    .' + c));
  }
}
