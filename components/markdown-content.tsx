import type { ReactNode } from "react";

function inline(value:string):ReactNode[]{
  return value.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((part,index)=>{
    if(part.startsWith("**")&&part.endsWith("**"))return <strong key={index}>{part.slice(2,-2)}</strong>;
    if(part.startsWith("`")&&part.endsWith("`"))return <code key={index}>{part.slice(1,-1)}</code>;
    return part;
  });
}

export function MarkdownContent({value,empty}:{value:string;empty:string}){
  const lines=value.replace(/\r\n?/g,"\n").split("\n");
  if(!value.trim())return <p className="markdown-empty">{empty}</p>;
  const content:ReactNode[]=[];
  let bullets:string[]=[];
  const flush=()=>{if(bullets.length){content.push(<ul key={`list-${content.length}`}>{bullets.map((item,index)=><li key={index}>{inline(item)}</li>)}</ul>);bullets=[];}};
  lines.forEach((line,index)=>{
    const bullet=line.match(/^\s*[-*]\s+(.+)$/);
    if(bullet){bullets.push(bullet[1]);return;}
    flush();
    const heading=line.match(/^(#{1,3})\s+(.+)$/);
    if(heading){const level=heading[1].length;content.push(level===1?<h3 key={index}>{inline(heading[2])}</h3>:level===2?<h4 key={index}>{inline(heading[2])}</h4>:<h5 key={index}>{inline(heading[2])}</h5>);return;}
    if(!line.trim()){content.push(<br key={index}/>);return;}
    content.push(<p key={index}>{inline(line)}</p>);
  });
  flush();
  return <div className="markdown-content">{content}</div>;
}
