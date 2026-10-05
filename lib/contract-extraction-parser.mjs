import {Worker} from 'node:worker_threads';
import {DocumentError} from './contract-document-engine.mjs';
export function parseContractEvidence(bytes,format,fields,kind){return new Promise((resolve,reject)=>{
 const worker=new Worker(new URL('../scripts/lib/contract-extraction-thread.mjs',import.meta.url),{workerData:{bytes,format,fields,kind},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:32},execArgv:[],env:{}});
 let done=false;const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();if(error)reject(error);else resolve(result);};
 const timer=setTimeout(()=>finish(new DocumentError('EXTRACTION_TIMEOUT')),12000);
 worker.once('message',result=>result.error?finish(new DocumentError(result.error)):finish(null,result));worker.once('error',()=>finish(new DocumentError('EXTRACTION_FAILED')));worker.once('exit',()=>finish(new DocumentError('EXTRACTION_FAILED')));
});}
