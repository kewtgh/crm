"use client";
/* eslint-disable @next/next/no-img-element -- authenticated, privately cached avatar; no public image optimizer. */
import { useEffect, useState } from "react";

export function UserAvatar({ initials, source }: { initials: string; source: string | null }) {
  const [override, setOverride] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const update = (event: Event) => {
      const url = (event as CustomEvent<{url: string}>).detail?.url;
      if (url?.startsWith("/api/settings/avatar")) setOverride(url);
    };
    window.addEventListener("lumina:avatar-updated", update);
    return () => window.removeEventListener("lumina:avatar-updated", update);
  }, []);
  const url = override ?? source;
  return <span className="user-avatar">{initials}{url && failed !== url && <img src={url} alt="" decoding="async" onError={() => setFailed(url)} />}</span>;
}
