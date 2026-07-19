import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import writeXlsxFile from "write-excel-file/node";
import fontkit from "@pdf-lib/fontkit";

const csvCell=value=>{const text=String(value??"");const safe=typeof value==="string"&&/^[=+@-]/.test(text)?`'${text}`:text;return`"${safe.replaceAll('"','""')}"`;};
const rows=[["中文名称","English name","Value"],["台北国际学校","Taipei International School","=unsafe"],["王小明","Alex Wang",1234]];
const csv=`\uFEFF${rows.map(row=>row.map(csvCell).join(",")).join("\r\n")}\r\n`;
assert.ok(csv.startsWith("\uFEFF"));
assert.match(csv,/"'=unsafe"/);

const sheet=rows.map((row,rowIndex)=>row.map(value=>({value:String(value),type:String,wrap:true,fontWeight:rowIndex===0?"bold":undefined})));
const xlsx=await writeXlsxFile(sheet,{stickyRowsCount:1,columns:rows[0].map(()=>({width:24}))}).toBuffer();
assert.equal(xlsx.subarray(0,2).toString(),"PK");

const css=await readFile(new URL("../node_modules/@fontsource/noto-sans-sc/400.css",import.meta.url),"utf8");
const match=[...css.matchAll(/src:\s*url\(\.\/files\/([^)]+\.woff2)\)[\s\S]*?unicode-range:\s*([^;]+);/g)].find(entry=>{
  const point="中".codePointAt(0);
  return entry[2].split(",").some(raw=>{const parsed=/U\+([0-9a-f]+)(?:-([0-9a-f]+))?/i.exec(raw);return parsed&&point>=Number.parseInt(parsed[1],16)&&point<=Number.parseInt(parsed[2]??parsed[1],16);});
});
assert.ok(match,"A Noto Sans SC subset must cover Chinese export text");
const document=await PDFDocument.create();
document.registerFontkit(fontkit);
const font=await document.embedFont(await readFile(new URL(`../node_modules/@fontsource/noto-sans-sc/files/${match[1]}`,import.meta.url)),{subset:true});
const page=document.addPage([595,842]);
page.drawText("中",{x:40,y:790,size:12,font});
const pdf=Buffer.from(await document.save());
assert.equal(pdf.subarray(0,4).toString(),"%PDF");

await rm(new URL("../work/export-artifact-smoke.tmp",import.meta.url),{force:true}).catch(()=>undefined);
process.stdout.write(`Export artifact smoke passed: CSV ${Buffer.byteLength(csv)} bytes, XLSX ${xlsx.length} bytes, PDF ${pdf.length} bytes with Chinese font embedding.\n`);
