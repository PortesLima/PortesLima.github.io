// Roda todos os tests/test-*.js em sequência; sai com código != 0 se algum falhar.
const { readdirSync } = require('fs');
const { spawnSync } = require('child_process');
let ruim = 0;
for(const f of readdirSync(__dirname).filter(f => /^test-.*\.js$/.test(f)).sort()){
  console.log('\n### ' + f);
  const r = spawnSync(process.execPath, [require('path').join(__dirname, f)], { stdio: 'inherit' });
  if(r.status !== 0){ ruim++; console.log('>>> ' + f + ' FALHOU'); }
}
console.log(ruim ? `\n${ruim} script(s) com falha` : '\ntudo verde');
process.exit(ruim ? 1 : 0);
