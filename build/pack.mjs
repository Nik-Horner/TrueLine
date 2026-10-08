// Package portable Windows/Linux apps or macOS .app bundles.
import './verify-models.mjs';
import { packager } from '@electron/packager';
import {readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{platform:{type:'string',default:'win32'},out:{type:'string',default:'dist'},arch:{type:'string',default:'x64'}}});
if(!['win32','linux','darwin'].includes(values.platform))throw Error('Supported packaging platforms are win32, linux and darwin.');
if(!['x64','arm64'].includes(values.arch))throw Error('Supported architectures are x64 and arm64.');
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));

const appPaths = await packager({
  dir: '.',
  out: values.out,
  overwrite: true,
  platform: values.platform,
  arch: values.arch,
  name: 'TrueLine',
  icon: values.platform === 'darwin' ? 'build/icon.icns' : 'build/icon.ico',
  appBundleId: 'com.trueline.cad',
  appCategoryType: 'public.app-category.graphics-design',
  asar: false,                    // keep app files plain on disk so the static server reads them directly
  appVersion: pkg.version,
  appCopyright: 'MIT — free to use and redistribute',
  win32metadata: {
    CompanyName: 'TrueLine',
    FileDescription: 'TrueLine — pen tablet to DXF',
    ProductName: 'TrueLine',
    OriginalFilename: 'TrueLine.exe',
  },
  // nothing here is needed at runtime except the app source, so drop everything else
  // Package only application files and production dependencies. In particular,
  // never copy evaluation photos, Python environments or previous installers.
  prune:true,
  ignore:file=>!!file&&!/^\/(index\.html|style\.css|package\.json|package-lock\.json|LICENSE|js|fonts|models|electron|node_modules)(\/|$)/.test(file.replaceAll('\\','/')),
});

console.log('Packaged to:', appPaths.join(', '));
