import type {AnchorHTMLAttributes} from "react";
import {qaNavigate} from "./ux-foundation-navigation";
export default function Link(props:AnchorHTMLAttributes<HTMLAnchorElement>){return <a {...props} onClick={event=>{props.onClick?.(event);if(!event.defaultPrevented&&props.href?.startsWith("/")&&!event.ctrlKey&&!event.metaKey){event.preventDefault();qaNavigate(props.href);}}}/>;}
