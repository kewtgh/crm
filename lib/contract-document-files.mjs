import {readFile} from "node:fs/promises";
import path from "node:path";
import {lintDocx} from "./contract-document-engine.mjs";
export async function readRegisteredTemplate(version,root=process.cwd()) {
  const catalog=JSON.parse(await readFile(path.join(root,"templates/contracts/catalog.json"),"utf8"));
  // Paths are server registry values, never a request parameter. No arbitrary files or symlinks outside registry.
  if(!catalog.versions.some(v=>v.template_path===version.template_path))throw new Error("TEMPLATE_PATH_NOT_REGISTERED");
  const bytes=await readFile(path.join(root,version.template_path));lintDocx(version,bytes);return bytes;
}
export async function readDocumentCatalog(root=process.cwd()) {return JSON.parse(await readFile(path.join(root,"templates/contracts/catalog.json"),"utf8"));}
