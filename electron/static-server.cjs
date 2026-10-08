const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const MIME={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.onnx':'application/octet-stream','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
function createStaticServer(root){
 root=path.resolve(root);
 return http.createServer((req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
  let name;
  try{name=decodeURIComponent((req.url||'/').split('?')[0]);}catch{res.writeHead(400).end();return;}
  if(name.includes('\0')||name.includes('\\')){res.writeHead(400).end();return;}
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  const relative=path.relative(root,file).split(path.sep).join('/');
  if(!['index.html','style.css'].includes(relative)&&!['js/','fonts/','models/'].some(prefix=>relative.startsWith(prefix))){res.writeHead(404).end();return;}
  fs.readFile(file,(error,data)=>{
   if(error){res.writeHead(404).end('not found');return;}
   res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Content-Length':data.length,'Cache-Control':'no-store'});
   res.end(req.method==='HEAD'?undefined:data);
  });
 });
}
module.exports={createStaticServer};
