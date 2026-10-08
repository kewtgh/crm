"use client";
import {createContext,useContext,type HTMLAttributes} from "react";
import {UiIcon,type UiIconName} from "./ui-icon";
export const WorkspaceIconContext=createContext<UiIconName>("section");
/** Keep the actual h1, accessible name and caller attributes; the icon is decorative. */
export function WorkspaceHeading({children,className="",...props}:HTMLAttributes<HTMLHeadingElement>){
 const icon=useContext(WorkspaceIconContext);
 return <h1 {...props} className={`workspace-heading ${className}`}><span className="workspace-heading-icon" aria-hidden="true"><UiIcon name={icon} size={24}/></span><span>{children}</span></h1>;
}
