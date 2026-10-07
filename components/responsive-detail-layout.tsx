import type { ReactNode } from "react";

/** Layout only: each owning domain supplies its already-authorized content. */
export function ResponsiveDetailLayout({ children, context }: { children: ReactNode; context?: ReactNode }) {
  return <div className={`ux-detail-layout${context ? " has-context" : ""}`}><div className="ux-detail-main">{children}</div>{context && <aside className="ux-detail-context">{context}</aside>}</div>;
}

export function SectionHeader({ title, help, action }: { title: string; help?: ReactNode; action?: ReactNode }) {
  return <header className="ux-section-header"><div><h2>{title}</h2>{help && <p>{help}</p>}</div>{action}</header>;
}
