"""Create local draft labels for supplied captures; only the reviewed paper label is suitable for training."""
from pathlib import Path
import cv2
import numpy as np

root=Path(__file__).resolve().parents[2]
folder=root/'test-artifacts/user-photos'
# Regions were selected from the supplied photographs, not from model output.
regions={'IMG_5422':(.14,.16,.88,.72),'IMG_5418':(.1,.19,.9,.77),'IMG_5419':(.2,.34,.72,.63)}
for name,(x0,y0,x1,y1) in regions.items():
    image=cv2.imread(str(folder/f'{name}-input.png'))
    h,w=image.shape[:2]
    hsv=cv2.cvtColor(image,cv2.COLOR_BGR2HSV)
    if name=='IMG_5419':
        mask=((hsv[:,:,0]>90)&(hsv[:,:,0]<135)&(hsv[:,:,1]>80)).astype(np.uint8)
    else:
        mask=(image.max(axis=2)<115).astype(np.uint8)
    region=np.zeros_like(mask);region[int(y0*h):int(y1*h),int(x0*w):int(x1*w)]=1;mask*=region
    count,components,stats,_=cv2.connectedComponentsWithStats(mask)
    mask=(components==(1+stats[1:,cv2.CC_STAT_AREA].argmax())).astype(np.uint8)
    contours,hierarchy=cv2.findContours(mask,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE)
    for loop,v in zip(contours,hierarchy[0]):
        if v[3]>=0 and cv2.contourArea(loop)<50:cv2.drawContours(mask,[loop],-1,1,-1)
    cv2.imwrite(str(folder/f'{name}-label.png'),mask*255)
    contours,hierarchy=cv2.findContours(mask,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE)
    overlay=image.copy();cv2.drawContours(overlay,contours,-1,(255,255,0),2)
    cv2.imwrite(str(folder/f'{name}-label-review.png'),overlay)
    print(name,'material pixels',int(mask.sum()),'openings',sum(1 for v in hierarchy[0] if v[3]>=0))
