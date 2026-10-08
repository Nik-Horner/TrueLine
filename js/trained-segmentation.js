// Local MobileSAM inference. Images and masks never leave this device.
import * as ort from './vendor/onnx/ort.wasm.min.mjs';
import {autoTraceRaster,traceTrainedMask} from './autotrace.js';
import {prepareTraceRaster} from './trace-input.js';
import {outlineIssue} from './outline-editor.js';
ort.env.wasm.wasmPaths=new URL('./vendor/onnx/',import.meta.url).href;
ort.env.wasm.numThreads=1;
let sessions;
async function loadModel(progress){
  if(!sessions){
    progress?.('Loading local segmentation model…');
    sessions=Promise.all(['encoder','decoder'].map(name=>ort.InferenceSession.create(new URL(`../models/mobile-sam/${name}.onnx`,import.meta.url).href,{executionProviders:['wasm'],graphOptimizationLevel:'all'}))).catch(error=>{sessions=null;throw new Error('The local outline model could not be loaded. Repair or reinstall TrueLine.',{cause:error});});
  }
  return sessions;
}
function imageTensor(width,height,rgba){
  const scale=1024/Math.max(width,height),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  const source=new OffscreenCanvas(width,height),ctx=source.getContext('2d');ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba),width,height),0,0);
  const canvas=new OffscreenCanvas(w,h),scaled=canvas.getContext('2d',{willReadFrequently:true});scaled.imageSmoothingEnabled=true;scaled.imageSmoothingQuality='high';scaled.drawImage(source,0,0,w,h);
  const pixels=scaled.getImageData(0,0,w,h).data,data=new Float32Array(3*1024*1024),mean=[123.675,116.28,103.53],std=[58.395,57.12,57.375];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++)data[c*1024*1024+y*1024+x]=(pixels[(y*w+x)*4+c]-mean[c])/std[c];
  return {tensor:new ort.Tensor('float32',data,[1,3,1024,1024]),sx:w/width,sy:h/height};
}
function simplePalette(rgba){
  const colors=new Set();for(let i=0;i<rgba.length;i+=4){colors.add((rgba[i]<<16)|(rgba[i+1]<<8)|rgba[i+2]);if(colors.size>16)return false;}return true;
}
export async function traceWithModel(width,height,rgba,options={},progress){
  rgba=prepareTraceRaster(width,height,rgba);
  let proposal;
  try{proposal=autoTraceRaster(width,height,rgba,options);}catch(error){
    if(!/Could not isolate|No usable outline/.test(error.message))throw error;
    proposal={contours:[],entities:[],segmentation:'no-edge-proposal',warnings:[],suppressedOpenings:0,quality:{weakBoundaryFraction:1,weakSegments:[],uncertainOpenings:0}};
  }
  // Exact simple raster circles need no neural smoothing or approximation.
  if((proposal.entities.every(e=>e.type==='circle')||simplePalette(rgba))&&proposal.quality.weakBoundaryFraction<.05)return {...proposal,engine:'Exact image edges'};
  const [encoder,decoder]=await loadModel(progress),input=imageTensor(width,height,rgba);
  progress?.('Segmenting the part…');
  const features=await encoder.run({pixel_values:input.tensor});
  const points=proposal.contours[0]||[{x:3,y:3},{x:width-3,y:height-3}],bounds=points.reduce((b,p)=>({x0:Math.min(b.x0,p.x),y0:Math.min(b.y0,p.y),x1:Math.max(b.x1,p.x),y1:Math.max(b.y1,p.y)}),{x0:width,y0:height,x1:0,y1:0});
  const coords=new Float32Array([Math.max(0,bounds.x0-3)*input.sx,Math.max(0,bounds.y0-3)*input.sy,Math.min(width-1,bounds.x1+3)*input.sx,Math.min(height-1,bounds.y1+3)*input.sy]);
  async function decode(coordinates,labels){
    return decoder.run({image_embeddings:features.image_embeddings,point_coords:new ort.Tensor('float32',new Float32Array(coordinates),[1,labels.length,2]),point_labels:new ort.Tensor('float32',new Float32Array(labels),[1,labels.length]),mask_input:new ort.Tensor('float32',new Float32Array(256*256),[1,1,256,256]),has_mask_input:new ort.Tensor('float32',new Float32Array([0]),[1]),orig_im_size:new ort.Tensor('float32',new Float32Array([height,width]),[2])});
  }
  function candidates(decoded){
    const scores=decoded.iou_predictions.data,order=Array.from({length:scores.length-1},(_,i)=>i+1).sort((a,b)=>scores[b]-scores[a]),out=[];
    for(const chosen of order){
      const values=decoded.masks.data,mask=new Uint8Array(width*height),offset=chosen*width*height;
      for(let i=0;i<mask.length;i++)mask[i]=values[offset+i]>0?1:0;
      try{
        const candidate=traceTrainedMask(width,height,rgba,mask,proposal,{...options,materialLogits:values.subarray(offset,offset+width*height)});
        if(!outlineIssue(candidate.entities))out.push(candidate);
      }catch{/* Other mask scales may still identify the whole part. */}
    }
    return out;
  }
  const decoded=await decode(coords,[2,3]);progress?.('Refining image edges…');
  let found=candidates(decoded);
  if(!found.length||bounds.x0<4||bounds.y0<4||bounds.x1>width-4||bounds.y1>height-4){
    progress?.('Checking alternative part regions…');
    for(const [x,y]of [[.5,.75],[.25,.5],[.75,.5],[.5,.25],[.5,.5]]){
      const alternatives=candidates(await decode([x*width*input.sx,y*height*input.sy,0,0],[1,-1]));found.push(...alternatives);
    }
    const evidenceScore=r=>r.foregroundPixels*(1-r.quality.weakBoundaryFraction)**2;
    found.sort((a,b)=>evidenceScore(b)-evidenceScore(a));
  }
  if(!found.length)throw new Error('Could not identify the part. Crop closely around one part with background on all sides.');
  return found[0];
}
