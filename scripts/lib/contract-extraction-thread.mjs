import {parentPort,workerData} from 'node:worker_threads';
import {docxChunks,pdfChunks,extractCandidates,extractorVersion} from '../../lib/contract-extraction-engine.mjs';
// The parser receives only bytes and declared field keys, no credentials or source objects.
globalThis.fetch=async()=>{throw new Error('EXTRACTION_NETWORK_FORBIDDEN');};
try{const chunks=workerData.format==='DOCX'?docxChunks(workerData.bytes):await pdfChunks(workerData.bytes);parentPort.postMessage({chunks,candidates:extractCandidates(chunks,workerData.fields,workerData.kind),extractorVersion});}
catch(error){parentPort.postMessage({error:error.code??'EXTRACTION_FAILED'});}
