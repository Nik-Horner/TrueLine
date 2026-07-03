// Package TrueLine into a portable Windows app folder.  node build/pack.mjs
import { packager } from '@electron/packager';

const appPaths = await packager({
  dir: '.',
  out: 'dist',
  overwrite: true,
  platform: 'win32',
  arch: 'x64',
  name: 'TrueLine',
  icon: 'build/icon.ico',
  asar: false,                    // keep app files plain on disk so the static server reads them directly
  appVersion: '3.0.0',
  appCopyright: 'MIT — free to use and redistribute',
  win32metadata: {
    CompanyName: 'TrueLine',
    FileDescription: 'TrueLine — pen tablet to DXF',
    ProductName: 'TrueLine',
    OriginalFilename: 'TrueLine.exe',
  },
  // nothing here is needed at runtime except the app source, so drop everything else
  ignore: [
    /^\/node_modules($|\/)/,
    /^\/dist($|\/)/,
    /^\/dist-test($|\/)/,
    /^\/tests($|\/)/,
    /^\/build($|\/)/,
    /^\/\.git($|\/)/,
    /^\/scratchpad($|\/)/,
    /\.log$/,
    /^\/build-icon-256\.png$/,
    /^\/(ARCHITECTURE|GEOM_API|research-.*)\.(md|txt)$/,
    /^\/(desktop-app|first-launch.*|help-.*|keybinds-.*|tour-.*|canvas)\.png$/,
  ],
});

console.log('Packaged to:', appPaths.join(', '));
