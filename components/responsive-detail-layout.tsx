import type { ReactNode } from "react";
import { UiIcon } from "./ui-icon";

/** Layout only: each owning domain supplies its already-authorized content. */
export function ResponsiveDetailLayout({ children, context }: { children: ReactNode; context?: ReactNode }) {
  return <div className={`ux-detail-layout${context ? " has-context" : ""}`}><div className="ux-detail-main">{children}</div>{context && <aside className="ux-detail-context">{context}</aside>}</div>;
}

export function SectionHeader({ title, help, action, icon }: { title: string; help?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return <header className="ux-section-header"><div className="ux-section-title"><span className="ux-section-icon" aria-hidden="true">{icon ?? <UiIcon name="section"/>}</span><div><h2>{title}</h2>{help && <p>{help}</p>}</div></div>{action && <div className="ux-section-actions">{action}</div>}</header>;
}
