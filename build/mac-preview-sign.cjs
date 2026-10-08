// Preview builds have no Developer ID certificate, but every nested executable
// still needs a consistent local signature after Electron is renamed/repacked.
const path = require('node:path');
const {execFileSync} = require('node:child_process');
module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const {sign} = await import('@electron/osx-sign');
  await sign({app, identity:'-', identityValidation:false, platform:'darwin',
    preAutoEntitlements:false, optionsForFile:()=>({hardenedRuntime:false})});
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',app],{stdio:'inherit'});
};
