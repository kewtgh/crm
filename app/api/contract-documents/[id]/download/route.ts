import {NextResponse} from "next/server";
import {apiRoute,ApiError,parseUuid,requireApiCapability} from "@/lib/api";
import {downloadContractDocument} from "@/lib/contract-document-repository";
import {verifyDocumentArtifact,docxMime,documentFilename} from "@/lib/contract-document-engine.mjs";
import {objectStore} from "@/lib/storage/object-store";
async function get(_:Request,{params}:{params:Promise<{id:string}>}) {
 await requireApiCapability("contracts.view");
 const lineage=await downloadContractDocument(parseUuid((await params).id));
 const artifact=await objectStore().get(lineage.key);
 if(!artifact||!verifyDocumentArtifact(artifact.body,lineage))throw new ApiError("DOCUMENT_ARTIFACT_INTEGRITY_FAILED",409);
 // Proxy each download after current source authorization; never a persistent bearer URL.
 return new NextResponse(Buffer.from(artifact.body),{headers:{"content-type":docxMime,"content-length":String(artifact.body.byteLength),"cache-control":"private, no-store",
  "content-disposition":`attachment; filename="Contract-v${lineage.version}.docx"; filename*=UTF-8''${encodeURIComponent(documentFilename(lineage.reference,lineage.version))}`}});
}
export const GET=apiRoute(get,"DOCUMENT_DOWNLOAD_FAILED");
