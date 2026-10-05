import {DocumentError} from './contract-document-engine.mjs';
export async function boundedUploadForm(request){
 const limit=8_200_000;if(!/^multipart\/form-data;\s*boundary=/i.test(request.headers.get('content-type')??''))throw new DocumentError('UPLOAD_FORMAT_UNSUPPORTED');
 if(Number(request.headers.get('content-length')??0)>limit)throw new DocumentError('UPLOAD_SIZE_INVALID');
 const reader=request.body?.getReader();if(!reader)throw new DocumentError('UPLOAD_SIZE_INVALID');const parts=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new DocumentError('UPLOAD_SIZE_INVALID');}parts.push(value);}}finally{reader.releaseLock();}
 try{return await new Request(request.url,{method:'POST',headers:{'content-type':request.headers.get('content-type')},body:Buffer.concat(parts)}).formData();}catch{throw new DocumentError('UPLOAD_INPUT_INVALID');}
}
