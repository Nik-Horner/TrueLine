// Download pinned evaluation inputs on demand; do not redistribute photos in the app.
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync as exec} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const sources=JSON.parse(readFileSync(new URL('./fixtures/photo-sources.json',import.meta.url)));
for(const [group,cases] of Object.entries(sources)) {
  const dir=join(root,group==='complex'?'test-artifacts/complex-parts':'test-artifacts/model-evaluation/additional-parts');
  mkdirSync(dir,{recursive:true});
  for(const c of cases) {
    const input=join(dir,c.id+'-input.png');
    if(existsSync(input))continue;
    const source=join(dir,group==='complex'?c.source:'realiad.png');
    if(!existsSync(source))exec('curl',['--fail','--location','--silent','--show-error','--max-time','60',c.url,'-o',source]);
    const args=[source];if(c.crop)args.push('-crop',c.crop,'+repage');
    args.push('-resize','2048x2048>','-background','white','-alpha','remove','-alpha','off','-depth','8',input);
    exec('magick',args);console.log('Prepared',c.id);
  }
  writeFileSync(join(dir,'sources.json'),JSON.stringify(cases,null,2));
}
