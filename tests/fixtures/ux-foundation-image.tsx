import type {ImgHTMLAttributes} from "react";
// Image transport only; actual application shell/brand content is preserved.
export default function Image({priority,...props}:ImgHTMLAttributes<HTMLImageElement>&{priority?:boolean}){
  void priority;
  // QA transport runs outside Next's image optimizer; application image identity is unchanged.
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={props.alt??""}/>;
}
