// The classical proposal and neural model must see the same white-composited
// pixels, including PNGs with transparent backgrounds or openings.
export function prepareTraceRaster(width,height,rgba) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16)
    throw new Error('Choose an image at least 16 × 16 pixels.');
  if(width*height>2048*2048)throw new Error('Resize the image to at most 4 megapixels before tracing.');
  if(!(rgba instanceof Uint8Array||rgba instanceof Uint8ClampedArray)||rgba.length!==width*height*4)
    throw new Error('The image pixels are incomplete or invalid. Reload the image and try again.');
  let result=rgba;
  for(let i=3;i<rgba.length;i+=4)if(rgba[i]!==255){
    if(result===rgba)result=new Uint8ClampedArray(rgba);
    const alpha=rgba[i]/255;
    for(let c=1;c<=3;c++)result[i-c]=rgba[i-c]*alpha+255*(1-alpha);
    result[i]=255;
  }
  return result;
}
