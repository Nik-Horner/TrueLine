"""Evaluate pretrained masks; reference annotations never guide prompts."""
import sys,json,time,pathlib
import numpy as np,cv2,torch
sys.path.insert(0,str(pathlib.Path(__file__).parent/'MobileSAM'))
from mobile_sam import sam_model_registry,SamPredictor
root=pathlib.Path(__file__).resolve().parents[2];out=root/'test-artifacts/model-evaluation';out.mkdir(exist_ok=True)
torch.set_num_threads(4)
model=sam_model_registry['vit_t'](checkpoint=str(pathlib.Path(__file__).parent/'mobile_sam.pt')).eval()
predictor=SamPredictor(model);rows=[]
refs=json.loads((root/'tests/fixtures/precision-reference.json').read_text());screw=json.loads((root/'tests/fixtures/screw-reference.json').read_text())['points']
for id in ['screw','steel-bracket','foam-rectangular','foam-irregular','white-switch-plate','sim-slot','white-bracket']:
 source=root/'test-artifacts/complex-parts'/f'{id}-input.png';rgb=cv2.cvtColor(cv2.imread(str(source)),cv2.COLOR_BGR2RGB);h,w=rgb.shape[:2]
 old=json.loads((root/'test-artifacts/complex-parts'/f'{id}-after-geometry.json').read_text());outline=np.array([[p['x'],p['y']] for p in old['contours'][0]],np.float32)
 classic=np.zeros((h,w),np.uint8);cv2.fillPoly(classic,[np.round(outline).astype(np.int32)],1)
 dist=cv2.distanceTransform(classic,cv2.DIST_L2,5);y,x=np.unravel_index(dist.argmax(),dist.shape)
 bbox=np.array([outline[:,0].min(),outline[:,1].min(),outline[:,0].max(),outline[:,1].max()]);pad=np.array([-3,-3,3,3]);bbox=np.clip(bbox+pad,[0,0,0,0],[w-1,h-1,w-1,h-1])
 start=time.monotonic();predictor.set_image(rgb);encoded=time.monotonic()-start
 reference=None
 if id=='screw':reference=np.array([[p['x'],p['y']]for p in screw],np.float32)
 if id=='steel-bracket':reference=np.array(refs[id]['outline'],np.float32)
 gt=np.zeros((h,w),np.uint8)
 if reference is not None:cv2.fillPoly(gt,[np.round(reference).astype(np.int32)],1)
 for name,prompts in [('full-box',dict(box=np.array([2,2,w-3,h-3]))),('detected-box',dict(box=bbox)),('detected-point',dict(point_coords=np.array([[x,y]]),point_labels=np.array([1]))),('box-and-point',dict(box=bbox,point_coords=np.array([[x,y]]),point_labels=np.array([1])) )]:
  start=time.monotonic();masks,scores,logits=predictor.predict(**prompts,multimask_output=True)
  k=int(scores.argmax());mask=masks[k].astype(np.uint8);loops,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE);filled=np.zeros_like(mask)
  if loops:cv2.drawContours(filled,[max(loops,key=cv2.contourArea)],-1,1,-1)
  cv2.imwrite(str(out/f'{id}-{name}-mask.png'),mask*255)
  overlay=cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR);cv2.drawContours(overlay,loops,-1,(255,255,0),max(1,w//700));cv2.imwrite(str(out/f'{id}-{name}-overlay.png'),overlay)
  row=dict(id=id,prompt=name,encoderSeconds=round(encoded,3),decoderSeconds=round(time.monotonic()-start,3),predictedMaskScore=float(scores[k]),maskFraction=float(mask.mean()))
  if reference is not None:row['silhouetteIoU']=float(np.logical_and(filled,gt).sum()/max(1,np.logical_or(filled,gt).sum()))
  rows.append(row);print(json.dumps(row),flush=True)
(out/'mobilesam-results.json').write_text(json.dumps(rows,indent=2))
