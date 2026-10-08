// Verify and launch the shipped app after copying it out of each DMG.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
if(process.platform!=='darwin')throw Error('Run Mac package checks on macOS.');
for(const arch of ['arm64','x64']) {
 const dmg=path.resolve('dist-installer',`TrueLine-${require('../package.json').version}-${arch}.dmg`);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'trueline-dmg-')),mount=path.join(temp,'mounted'),copied=path.join(temp,'Applications','TrueLine.app');
 fs.mkdirSync(mount);fs.mkdirSync(path.dirname(copied));
 let attached=false;
 try {
  execFileSync('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,dmg],{stdio:'inherit'});attached=true;
  execFileSync('/usr/bin/ditto',[path.join(mount,'TrueLine.app'),copied],{stdio:'inherit'});
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',copied],{stdio:'inherit'});
  execFileSync(process.execPath,[path.join(__dirname,'desktop-smoke.cjs')],{env:{...process.env,TRUELINE_EXECUTABLE:path.join(copied,'Contents','MacOS','TrueLine')},stdio:'inherit',timeout:150000});
  console.log('PASS: installed '+arch+' DMG signature, production startup and drawing/export workflows');
 } finally { if(attached)execFileSync('/usr/bin/hdiutil',['detach',mount],{stdio:'inherit'}); }
}
