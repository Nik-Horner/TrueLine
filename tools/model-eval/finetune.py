"""Local decoder fine-tuning on generated CAD masks; never reads evaluation photos."""
import argparse, hashlib, json, random, sys, time, subprocess, importlib.metadata
from pathlib import Path
import cv2
import numpy as np
import torch
from torch.nn import functional as F

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'MobileSAM'))
from mobile_sam import sam_model_registry
from mobile_sam.utils.onnx import SamOnnxModel


def sample(seed):
    rng=np.random.default_rng(seed);size=512
    mask=np.zeros((size,size),np.uint8)
    center=(256,256);radius=int(rng.integers(125,195));thick=int(rng.integers(10,28))
    kind=seed%4
    if kind==0:
        cv2.circle(mask,center,radius,1,-1);cv2.circle(mask,center,radius-thick,0,-1)
    elif kind==1:
        cv2.rectangle(mask,(90,70),(420,445),1,-1);cv2.rectangle(mask,(90+thick,70+thick),(420-thick,445-thick),0,-1)
        for x,y in [(95,85),(410,90),(100,430),(410,425)]:
            cv2.circle(mask,(x,y),thick+9,1,-1);cv2.circle(mask,(x,y),max(4,thick//3),0,-1)
    elif kind==2:
        poly=np.array([[80,90],[410,90],[410,160],[190,160],[190,430],[80,430]],np.int32)
        cv2.fillPoly(mask,[poly],1)
        for x,y in [(125,125),(125,380),(370,125)]:cv2.circle(mask,(x,y),int(rng.integers(7,20)),0,-1)
    else:
        cv2.rectangle(mask,(110,150),(400,360),1,-1)
        for x in [170,340]:cv2.circle(mask,(x,255),int(rng.integers(14,40)),0,-1)
    transform=cv2.getRotationMatrix2D(center,float(rng.uniform(-180,180)),float(rng.uniform(.65,.8)))
    mask=cv2.warpAffine(mask,transform,(size,size),flags=cv2.INTER_NEAREST)
    yy,xx=np.mgrid[:size,:size];u=xx*np.cos(seed*.37)+yy*np.sin(seed*.37)
    if seed%3:
        grain=10*np.sin(u*.16+3*np.sin(yy*.014))+5*np.sin(u*.73)+rng.normal(0,2,(size,size))
        background=np.array([184,146,98])+grain[:,:,None]
    else:background=np.full((size,size,3),float(rng.uniform(180,250)))
    light=(.7+.3*(xx/size)+.1*np.sin(yy/size*3))[:,:,None]
    background=background*light
    shift=np.float32([[1,0,rng.uniform(-15,15)],[0,1,rng.uniform(4,18)]])
    shadow=cv2.GaussianBlur(cv2.warpAffine(mask.astype(np.float32),shift,(size,size)),(0,0),float(rng.uniform(2,9)))
    background*=1-shadow[:,:,None]*float(rng.uniform(.2,.6))
    color=np.array([rng.uniform(10,55),rng.uniform(15,65),rng.uniform(25,100)])
    material=color*light+rng.normal(0,3,(size,size,1))
    # Glare changes appearance, never the supervision mask.
    glare=np.exp(-((xx-rng.uniform(100,400))**2+(yy-rng.uniform(100,400))**2)/rng.uniform(500,9000))
    material+=glare[:,:,None]*rng.uniform(10,90)
    image=np.where(mask[:,:,None]>0,material,background)
    image=cv2.GaussianBlur(np.clip(image,0,255).astype(np.uint8),(0,0),.5)
    return image,mask


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--train-count',type=int,default=48);ap.add_argument('--validation-count',type=int,default=16)
    ap.add_argument('--training-image',type=Path);ap.add_argument('--training-mask',type=Path);ap.add_argument('--photo-count',type=int,default=24)
    ap.add_argument('--quality-only',action='store_true')
    ap.add_argument('--learning-rate',type=float,default=1e-5)
    ap.add_argument('--epochs',type=int,default=5);ap.add_argument('--output',type=Path,default=HERE.parents[1]/'test-artifacts/finetune')
    args=ap.parse_args()
    if min(args.train_count,args.validation_count,args.epochs)<1 or not 0<args.learning_rate<=1e-3:ap.error('counts and epochs must be positive')
    args.output.mkdir(parents=True,exist_ok=True)
    if (args.output/'candidate.pt').exists() or (args.output/'training.json').exists():
        ap.error('output already contains a run; choose a new output directory')
    torch.manual_seed(321);random.seed(321);torch.set_num_threads(4)
    device='mps' if torch.backends.mps.is_available() else 'cpu'
    checkpoint=HERE/'mobile_sam.pt'
    expected=json.loads((HERE.parents[1]/'models/mobile-sam/manifest.json').read_text())['checkpointSHA256']
    assert hashlib.sha256(checkpoint.read_bytes()).hexdigest()==expected,'Unexpected base checkpoint'
    model=sam_model_registry['vit_t'](checkpoint=str(checkpoint)).eval().to(device)
    # Verify the training box has the same embeddings as the deployed decoder.
    coords=torch.tensor([[[100.,120.],[800.,900.]]],device=device)
    with torch.no_grad():
        trained=model.prompt_encoder(points=None,boxes=coords.reshape(1,4),masks=None)[0]
        deployed=SamOnnxModel(model,return_single_mask=False)._embed_points(coords,torch.tensor([[2.,3.]],device=device))
        assert torch.allclose(trained,deployed,atol=1e-5),'Training and inference box prompts differ'
    for p in model.parameters():p.requires_grad=False
    for p in (model.mask_decoder.iou_prediction_head if args.quality_only else model.mask_decoder).parameters():p.requires_grad=True
    photo=None
    if args.training_image or args.training_mask:
        if not(args.training_image and args.training_mask):ap.error('supply both training image and reviewed mask')
        photo=cv2.cvtColor(cv2.imread(str(args.training_image)),cv2.COLOR_BGR2RGB);label=cv2.imread(str(args.training_mask),0)
        assert photo.shape[:2]==label.shape and label.max()==255
        x,y,w,h=cv2.boundingRect(label);side=int(max(w,h)*1.1);cx=x+w//2;cy=y+h//2
        photo=cv2.getRectSubPix(photo,(side,side),(float(cx),float(cy)));label=cv2.getRectSubPix(label,(side,side),(float(cx),float(cy)))
        photo=cv2.resize(photo,(512,512));label=(cv2.resize(label,(512,512),interpolation=cv2.INTER_NEAREST)>127).astype(np.uint8)
    train_seeds=list(range(args.train_count))+(list(range(8000,8000+args.photo_count)) if photo is not None else []);validation_seeds=list(range(10000,10000+args.validation_count))
    assert len(set(train_seeds))==len(train_seeds) and not set(train_seeds)&set(validation_seeds),'Training and validation seeds overlap'
    def encode(seed):
        image,mask=sample(seed)
        if photo is not None and 8000<=seed<8000+args.photo_count:
            rng=np.random.default_rng(seed)
            transform=cv2.getRotationMatrix2D((256,256),float(rng.uniform(-180,180)),.7)
            material=cv2.warpAffine(photo,transform,(512,512));mask=cv2.warpAffine(label,transform,(512,512),flags=cv2.INTER_NEAREST)
            yy,xx=np.mgrid[:512,:512];u=xx*np.cos(seed*.37)+yy*np.sin(seed*.37)
            grain=10*np.sin(u*.16+3*np.sin(yy*.014))+5*np.sin(u*.73)+rng.normal(0,2,(512,512))
            background=np.array([184,146,98])+grain[:,:,None]
            if seed%3==0:background=np.full((512,512,3),230.)
            shadow=cv2.GaussianBlur(np.roll(mask.astype(np.float32),(7,9),axis=(0,1)),(0,0),5)
            background=background.astype(np.float32)*(1-shadow[:,:,None]*.45)
            image=np.clip(np.where(mask[:,:,None]>0,material*rng.uniform(.7,1.3),background),0,255).astype(np.uint8)
        portrait=seed%2==1
        if portrait:
            rng=np.random.default_rng(seed+445)
            scale=float(rng.uniform(.45,.54));cx=float(rng.uniform(125,163));cy=float(rng.uniform(165,347))
            matrix=np.float32([[scale,0,cx-256*scale],[0,scale,cy-256*scale]])
            color=tuple(int(v) for v in image[0,0])
            image=cv2.warpAffine(image,matrix,(512,512),borderValue=color)
            mask=cv2.warpAffine(mask,matrix,(512,512),flags=cv2.INTER_NEAREST)
        assert mask.sum()>100 and mask[0].sum()==0 and mask[-1].sum()==0
        if portrait:assert mask[:,288:].sum()==0
        x=torch.from_numpy(image.transpose(2,0,1).copy()).float().unsqueeze(0).to(device)
        x=F.interpolate(x,size=(1024,1024),mode='bilinear',align_corners=False)
        x=(x-model.pixel_mean)/model.pixel_std
        if portrait:x[:,:,:,576:]=0
        with torch.no_grad():embedding=model.image_encoder(x).cpu()
        ys,xs=np.where(mask);box=np.array([xs.min(),ys.min(),xs.max(),ys.max()],np.float32)*2
        # The app supplies a noisy image-derived box; labels are never fed as masks.
        rng=np.random.default_rng(seed+99);pad=rng.uniform(0,160,4) if seed%3 else np.zeros(4)
        box+=pad*np.array([-1,-1,1,1])+rng.uniform(-8,8,4);box=np.clip(box,0,1023)
        target=torch.from_numpy(cv2.resize(mask.astype(np.float32),(256,256),interpolation=cv2.INTER_AREA)).unsqueeze(0).unsqueeze(0)
        return embedding,torch.from_numpy(box).view(1,2,2),target
    data={}
    for i,seed in enumerate(train_seeds+validation_seeds):
        data[seed]=encode(seed)
        if i%8==0:print(json.dumps({'encoding':i+1,'total':len(train_seeds)+len(validation_seeds)}),flush=True)
        if i<8:
            image,mask=sample(seed);cv2.imwrite(str(args.output/f'sample-{seed}.png'),cv2.cvtColor(image,cv2.COLOR_RGB2BGR));cv2.imwrite(str(args.output/f'sample-{seed}-mask.png'),mask*255)
    def forward(seed):
        embedding,box,target=data[seed];embedding=embedding.to(device);target=target.to(device)
        with torch.no_grad():
            sparse,dense=model.prompt_encoder(points=None,boxes=box.to(device).reshape(1,4),masks=None)
            pe=model.prompt_encoder.get_dense_pe()
        logits,scores=model.mask_decoder(image_embeddings=embedding,image_pe=pe,sparse_prompt_embeddings=sparse,dense_prompt_embeddings=dense,multimask_output=True)
        return logits,scores,target
    def evaluate(seeds):
        values=[]
        with torch.no_grad():
            for seed in seeds:
                logits,scores,target=forward(seed);pred=logits[0,scores[0].argmax()]>0;truth=target[0,0]>.5
                values.append(float(((pred&truth).sum()/(pred|truth).sum().clamp_min(1)).cpu()))
        return sum(values)/len(values)
    baseline=evaluate(validation_seeds);best=baseline;history=[]
    optimizer=torch.optim.AdamW((p for p in model.mask_decoder.parameters() if p.requires_grad),lr=args.learning_rate,weight_decay=.01)
    start=time.monotonic()
    for epoch in range(args.epochs):
        random.shuffle(train_seeds);losses=[]
        for seed in train_seeds:
            logits,scores,target=forward(seed);truth=target.expand_as(logits)
            bce=F.binary_cross_entropy_with_logits(logits,truth)
            prob=logits.sigmoid();dice=1-(2*(prob*truth).sum((-1,-2))+1)/(prob.sum((-1,-2))+truth.sum((-1,-2))+1)
            with torch.no_grad():
                pred=logits>0;gt=truth>.5;iou=(pred&gt).sum((-1,-2))/(pred|gt).sum((-1,-2)).clamp_min(1)
            loss=F.mse_loss(scores,iou) if args.quality_only else bce+dice.mean()+F.mse_loss(scores,iou)
            assert torch.isfinite(loss),'Nonfinite training loss'
            optimizer.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(model.mask_decoder.parameters(),1);optimizer.step();losses.append(float(loss.detach().cpu()))
        metric=evaluate(validation_seeds)
        row={'epoch':epoch+1,'loss':sum(losses)/len(losses),'syntheticValidationIoU':metric,'seconds':round(time.monotonic()-start,1)};history.append(row);print(json.dumps(row),flush=True)
        if metric>best:
            best=metric;torch.save({k:v.detach().cpu() for k,v in model.state_dict().items()},args.output/'candidate.pt')
        report={'baseCheckpointSHA256':expected,'upstreamCommit':subprocess.check_output(['git','-C',str(HERE/'MobileSAM'),'rev-parse','HEAD'],text=True).strip(),'versions':{name:importlib.metadata.version(name) for name in ['torch','torchvision','timm','numpy','opencv-python-headless']},'device':device,'qualityOnly':args.quality_only,'training':'Generated CAD shapes'+(' plus one explicitly supplied reviewed photo/mask; other captures remain evaluation-only.' if photo is not None else ' only; no evaluation or user photos used for training.')+' Seeds split before rendering; synthetic validation does not prove real-photo improvement.', 'trainingImage':str(args.training_image) if photo is not None else None,'trainSeeds':sorted(train_seeds),'validationSeeds':validation_seeds,'baselineSyntheticIoU':baseline,'bestSyntheticIoU':best,'history':history}
        (args.output/'training.json').write_text(json.dumps(report,indent=2))
    print('Candidate retained for separate real-photo evaluation; bundled model unchanged.',flush=True)

if __name__=='__main__':main()
