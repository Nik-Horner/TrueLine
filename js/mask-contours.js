// Trace the model's continuous mask at source-pixel centres. Keeping the
// interpolated crossing avoids rounding every boundary to a pixel staircase.
export function maskContours(width,height,values,level=0) {
  if(values.length!==width*height)throw new Error('Invalid continuous mask dimensions.');
  const nodes=new Map(),segments=[];
  const node=(id,x,y,a,b)=>{
    let n=nodes.get(id);if(!n){const t=Math.max(0,Math.min(1,(level-a)/(b-a||1)));n={point:{x:x+.5+(id[0]==='h'?t:0),y:y+.5+(id[0]==='v'?t:0)},edges:[]};nodes.set(id,n);}return n;
  };
  const link=(a,b)=>{if(segments.length>=100000)throw new Error('This image has too much edge detail. Crop closely around one part and try again.');const edge={a,b,used:false};a.edges.push(edge);b.edges.push(edge);segments.push(edge);};
  for(let y=0;y<height-1;y++)for(let x=0;x<width-1;x++){
    const i=y*width+x,a=values[i],b=values[i+1],c=values[i+width+1],d=values[i+width];
    const bits=(a>level?1:0)|(b>level?2:0)|(c>level?4:0)|(d>level?8:0);
    if(bits===0||bits===15)continue;
    const crossings=[];
    if((a>level)!==(b>level))crossings.push([0,node(`h${i}`,x,y,a,b)]);
    if((b>level)!==(c>level))crossings.push([1,node(`v${i+1}`,x+1,y,b,c)]);
    if((d>level)!==(c>level))crossings.push([2,node(`h${i+width}`,x,y+1,d,c)]);
    if((a>level)!==(d>level))crossings.push([3,node(`v${i}`,x,y,a,d)]);
    if(crossings.length===2)link(crossings[0][1],crossings[1][1]);
    else{
      // Asymptotic decider for a bilinear saddle. Adjacent cells share the
      // exact same edge vertices, including when a value equals the level.
      const determinant=(a-level)*(c-level)-(b-level)*(d-level);
      if(determinant>=0){link(crossings[0][1],crossings[1][1]);link(crossings[2][1],crossings[3][1]);}
      else{link(crossings[0][1],crossings[3][1]);link(crossings[1][1],crossings[2][1]);}
    }
  }
  const loops=[];
  for(const first of segments){
    if(first.used)continue;
    let edge=first,current=first.a;const start=current,points=[];
    do{points.push(current.point);edge.used=true;current=edge.a===current?edge.b:edge.a;if(current===start)break;edge=current.edges.find(e=>!e.used);}while(edge);
    if(current===start&&points.length>=3)loops.push(points);
  }
  const area=c=>c.reduce((s,a,i)=>{const b=c[(i+1)%c.length];return s+a.x*b.y-b.x*a.y;},0)/2;
  loops.sort((a,b)=>Math.abs(area(b))-Math.abs(area(a)));
  if(loops.length&&area(loops[0])<0)loops[0].reverse();
  return loops;
}
