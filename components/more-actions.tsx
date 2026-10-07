"use client";
import type { ReactNode } from "react";
import { ActionDisclosure } from "./action-disclosure";
/** Uses the existing native disclosure and its focus/Escape/outside-click behavior. */
export function MoreActions({label,children}:{label:string;children:ReactNode}) { return <ActionDisclosure label={label} menu>{children}</ActionDisclosure>; }
