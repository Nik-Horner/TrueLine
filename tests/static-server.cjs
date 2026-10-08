const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path'),{createStaticServer}=require('../electron/static-server.cjs');
(async()=>{
 const server=createStaticServer(path.resolve(__dirname,'..'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const request=(url,method='GET')=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:url,method},res=>{let bytes=0;res.on('data',b=>bytes+=b.length);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes}));});req.on('error',reject);req.end();});
 try{
  for(const url of['/%','/%E0%A4%A','/%00','/..%5celectron/main.cjs'])assert.equal((await request(url)).status,400,url);
  assert.equal((await request('/../TrueLine-private/secrets')).status,403);
  for(const url of['/electron/main.cjs','/package.json','/tests/autotrace.mjs','/test-artifacts/model-evaluation/report.html'])assert.equal((await request(url)).status,404,url);
  assert.equal((await request('/','POST')).status,405);
  for(const [url,type]of[['/','text/html'],['/js/vendor/onnx/ort.wasm.min.mjs','text/javascript'],['/js/vendor/onnx/ort-wasm-simd-threaded.wasm','application/wasm'],['/models/mobile-sam/decoder.onnx','application/octet-stream']]){
   const response=await request(url,'HEAD');assert.equal(response.status,200);assert.equal(response.headers['content-type'],type);assert.equal(response.bytes,0);assert.ok(Number(response.headers['content-length'])>0);
  }
  assert.ok((await request('/')).bytes>100,'malformed requests must not crash the app server');
  console.log('PASS: actual app server malformed URLs, path containment, private files, methods and model/runtime MIME types');
 }finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
