export type CsvDocument={headers:string[];rows:Array<Record<string,string>>;delimiter:string};

export class CsvParseError extends Error{
  constructor(public code:"EMPTY"|"UNCLOSED_QUOTE"|"DUPLICATE_HEADER"|"TOO_MANY_ROWS"){super(code);}
}

function detectDelimiter(text:string){
  const counts=new Map([[",",0],[";",0],["\t",0]]);
  let quoted=false;
  for(let index=0;index<text.length;index+=1){
    const char=text[index];
    if(char==='"'&&quoted&&text[index+1]==='"'){index+=1;continue;}
    if(char==='"'){quoted=!quoted;continue;}
    if(!quoted&&(char==="\n"||char==="\r"))break;
    if(!quoted&&counts.has(char))counts.set(char,(counts.get(char)??0)+1);
  }
  return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[1]? [...counts.entries()].sort((a,b)=>b[1]-a[1])[0][0]:",";
}

export function parseCsvDocument(source:string,maxRows=500):CsvDocument{
  const text=source.replace(/^\uFEFF/,"");
  const delimiter=detectDelimiter(text);
  const parsed:string[][]=[];
  let row:string[]=[];
  let value="";
  let quoted=false;
  const pushCell=()=>{row.push(value.trim());value="";};
  const pushRow=()=>{
    pushCell();
    if(row.some(cell=>cell.length))parsed.push(row);
    row=[];
  };
  for(let index=0;index<text.length;index+=1){
    const char=text[index];
    if(char==='"'&&quoted&&text[index+1]==='"'){value+='"';index+=1;continue;}
    if(char==='"'){quoted=!quoted;continue;}
    if(char===delimiter&&!quoted){pushCell();continue;}
    if((char==="\n"||char==="\r")&&!quoted){
      if(char==="\r"&&text[index+1]==="\n")index+=1;
      pushRow();
      continue;
    }
    value+=char;
  }
  if(quoted)throw new CsvParseError("UNCLOSED_QUOTE");
  if(value.length||row.length)pushRow();
  if(parsed.length<2)throw new CsvParseError("EMPTY");
  const headers=parsed[0].map(header=>header.trim());
  const normalized=headers.map(header=>header.toLocaleLowerCase());
  if(headers.some(header=>!header)||new Set(normalized).size!==headers.length)throw new CsvParseError("DUPLICATE_HEADER");
  const dataRows=parsed.slice(1);
  if(dataRows.length>maxRows)throw new CsvParseError("TOO_MANY_ROWS");
  return{
    headers,
    delimiter,
    rows:dataRows.map(cells=>Object.fromEntries(headers.map((header,index)=>[header,cells[index]??""]))),
  };
}
