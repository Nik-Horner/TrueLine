import { traceWithModel } from './trained-segmentation.js';

self.onmessage = async ({ data }) => {
  const { id, width, height, rgba, options } = data;
  try {
    const result=await traceWithModel(width,height,rgba,options,message=>self.postMessage({id,progress:message}));
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message || 'Could not trace this image.' });
  }
};
