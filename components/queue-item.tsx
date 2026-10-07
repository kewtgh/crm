import type { ReactNode } from "react";
/** Supplied context and actions only; the owning domain determines availability. */
export function QueueItem({identity,state,context,nextAction,signal,primaryAction,secondaryLink,more}:{identity:ReactNode;state:ReactNode;context:ReactNode;nextAction:ReactNode;signal?:ReactNode;primaryAction?:ReactNode;secondaryLink?:ReactNode;more?:ReactNode}) {
  return <article className="ux-queue-item"><div className="ux-queue-heading">{identity}{state}</div><div className="ux-queue-context">{context}</div><div className="ux-queue-next">{nextAction}</div>{signal&&<div className="ux-queue-signal">{signal}</div>}<div className="ux-queue-actions">{primaryAction}{secondaryLink}{more}</div></article>;
}
