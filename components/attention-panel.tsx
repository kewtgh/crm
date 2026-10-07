"use client";
import Link from "next/link";
import type { ReactNode } from "react";
export type AttentionItem = { id: string; title: string; description: string; href: string; actionLabel: string; priority: "urgent" | "high" | "normal" };
/** The owner supplies authorized items. This component has no task/count engine. */
export function AttentionPanel({ title, items, emptyLabel, summary, action }: { title: string; items: readonly AttentionItem[]; emptyLabel: string; summary?: ReactNode; action?: ReactNode }) {
  return <section className="ux-attention-panel" aria-label={title}><div className="surface-heading"><h2>{title}</h2>{action}</div>{summary}{items.length ? items.map(item => <article key={item.id} data-priority={item.priority}><div><b>{item.title}</b><p>{item.description}</p></div><Link href={item.href} className="secondary-button">{item.actionLabel}</Link></article>) : <p>{emptyLabel}</p>}</section>;
}
