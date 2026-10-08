import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
if(process.platform!=='darwin')throw Error('Build Mac preview installers on macOS.');
const require=createRequire(import.meta.url);
const result=spawnSync(process.execPath,[require.resolve('electron-builder/cli.js'),
  '--mac','--arm64','--x64','--publish','never',
  '-c.mac.identity=null','-c.mac.hardenedRuntime=false',
  '-c.afterPack=build/mac-preview-sign.cjs'],
  {stdio:'inherit',env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'}});
if(result.error)throw result.error;
process.exit(result.status??1);
