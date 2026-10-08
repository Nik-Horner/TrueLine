import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=process.argv[2]&&!process.argv[2].startsWith('--')?pathToFileURL(resolve(process.argv[2])+'/'):new URL('../',import.meta.url),manifest=JSON.parse(readFileSync(new URL('models/mobile-sam/manifest.json',root)));
for(const [name,expected] of Object.entries(manifest.files)){
 const file=new URL('models/mobile-sam/'+name,root);
 if(statSync(file).size!==expected.bytes||createHash('sha256').update(readFileSync(file)).digest('hex')!==expected.sha256)throw Error('Missing or modified model asset: '+name);
}
const runtime=JSON.parse(readFileSync(new URL('js/vendor/onnx/manifest.json',root))),pkg=JSON.parse(readFileSync(new URL('package.json',root)));
const pinned=pkg.devDependencies?.['onnxruntime-web']||pkg.dependencies?.['onnxruntime-web'];
// electron-builder removes development metadata from the installed package.
if(pinned&&runtime.version!==pinned)throw Error('Inference runtime version does not match package.json.');
for(const [name,expected]of Object.entries(runtime.files)){
 const file=new URL('js/vendor/onnx/'+name,root);
 if(statSync(file).size!==expected.bytes||createHash('sha256').update(readFileSync(file)).digest('hex')!==expected.sha256)throw Error('Missing or modified inference runtime: '+name);
}
for(const name of ['LICENSE','NOTICE'])if(!statSync(new URL('models/mobile-sam/'+name,root)).size)throw Error('Missing model notice: '+name);
console.log('PASS: bundled model checksums and inference runtime assets');
