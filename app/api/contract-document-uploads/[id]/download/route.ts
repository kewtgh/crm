import {NextResponse} from 'next/server';
import {apiRoute,ApiError,parseUuid,requireApiCapability} from '@/lib/api';
import {uploadRpc} from '@/lib/contract-upload-repository';
import {verifyDocumentArtifact} from '@/lib/contract-document-engine.mjs';
import {safeUploadName} from '@/lib/contract-extraction-engine.mjs';
import {objectStore} from '@/lib/storage/object-store';
async function get(_:Request,{params}:{params:Promise<{id:string}>}){await requireApiCapability('contracts.view');const row=await uploadRpc<{key:string;sha256:string;bytes:number;mime:string;filename:string}|null>('uploaded_original_download',{record_id:parseUuid((await params).id)});if(!row)throw new ApiError('UPLOAD_SOURCE_NOT_FOUND',404);const artifact=await objectStore().get(row.key);if(!artifact||!verifyDocumentArtifact(artifact.body,row))throw new ApiError('UPLOAD_ARTIFACT_INTEGRITY_FAILED',409);return new NextResponse(Buffer.from(artifact.body),{headers:{'content-type':row.mime,'content-length':String(artifact.body.length),'cache-control':'private, no-store','content-disposition':`attachment; filename="original.${row.mime==='application/pdf'?'pdf':'docx'}"; filename*=UTF-8''${encodeURIComponent(safeUploadName(row.filename))}`}});}
export const GET=apiRoute(get,'UPLOAD_DOWNLOAD_FAILED');
