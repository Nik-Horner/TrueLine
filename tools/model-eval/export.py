"""Export the evaluated MobileSAM checkpoint for offline ONNX inference."""
import sys,pathlib,torch,json,hashlib,argparse
sys.path.insert(0,str(pathlib.Path(__file__).parent/'MobileSAM'))
from mobile_sam import sam_model_registry
from mobile_sam.utils.onnx import SamOnnxModel
root=pathlib.Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--checkpoint',type=pathlib.Path,default=pathlib.Path(__file__).parent/'mobile_sam.pt');parser.add_argument('--output',type=pathlib.Path,default=root/'models/mobile-sam');args=parser.parse_args()
out=args.output;out.mkdir(parents=True,exist_ok=True)
torch.set_num_threads(4);model=sam_model_registry['vit_t'](checkpoint=str(args.checkpoint)).eval()
with torch.no_grad():
 torch.onnx.export(model.image_encoder,torch.zeros(1,3,1024,1024),str(out/'encoder.onnx'),input_names=['pixel_values'],output_names=['image_embeddings'],opset_version=17,dynamo=False)
 decoder=SamOnnxModel(model,return_single_mask=False).eval()
 inputs=(torch.zeros(1,256,64,64),torch.tensor([[[50.,50.],[950.,950.]]]),torch.tensor([[2.,3.]]),torch.zeros(1,1,256,256),torch.zeros(1),torch.tensor([256.,256.]))
 torch.onnx.export(decoder,inputs,str(out/'decoder.onnx'),input_names=['image_embeddings','point_coords','point_labels','mask_input','has_mask_input','orig_im_size'],output_names=['masks','iou_predictions','low_res_masks'],dynamic_axes={'point_coords':{1:'num_points'},'point_labels':{1:'num_points'},'masks':{2:'height',3:'width'}},opset_version=17,dynamo=False)
manifest=dict(name='MobileSAM',license='Apache-2.0',source='https://github.com/ChaoningZhang/MobileSAM',checkpointURL='https://raw.githubusercontent.com/ChaoningZhang/MobileSAM/master/weights/mobile_sam.pt' if args.checkpoint.name=='mobile_sam.pt' else None,checkpointSHA256=hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),files={p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}for p in out.glob('*.onnx')})
(out/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest,indent=2))
