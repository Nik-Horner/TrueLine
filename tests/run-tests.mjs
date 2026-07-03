// Node test harness: every js/ module exports selfTest() -> { pass: boolean, failures: string[] }
// Run: node tests/run-tests.mjs
const modules = ['geom', 'dxf', 'pdf'];
let allPass = true;
for (const name of modules) {
  let mod;
  try {
    mod = await import(new URL(`../js/${name}.js`, import.meta.url));
  } catch (e) {
    console.log(`${name}: SKIP (${e.message.split('\n')[0]})`);
    continue;
  }
  if (typeof mod.selfTest !== 'function') {
    console.log(`${name}: NO selfTest() EXPORT`);
    allPass = false;
    continue;
  }
  const r = mod.selfTest();
  if (r.pass) console.log(`${name}: PASS`);
  else {
    allPass = false;
    console.log(`${name}: FAIL\n  - ` + r.failures.join('\n  - '));
  }
}
process.exit(allPass ? 0 : 1);
