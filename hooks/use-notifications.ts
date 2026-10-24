"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { NotificationRecord } from "@/lib/notifications-repository";
import type { NotificationMutation } from "@/lib/notification-mutation";
import { useI18n } from "@/components/i18n-provider";
import { useRemoteSearch } from "./use-remote-search";
import {useCapability} from "@/components/app-user-context";
import {isDefinitiveMutationFailure} from "@/lib/mutation-outcome";

type NotificationPage = { items: NotificationRecord[]; total: number };
const changedEvent = "crm:notifications-changed";

export function useNotifications(initial?: NotificationPage) {
  const { t } = useI18n();
  const [items, setItems] = useState(initial?.items ?? []);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(!initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [refreshOnly,setRefreshOnly]=useState(false),[readFailed,setReadFailed]=useState(false);
  const canManage=useCapability("messages.manage");
  const busy = useRef(false);
  const queuedRefresh=useRef(false),readController=useRef<AbortController|null>(null);
  const hasInitial = Boolean(initial);
  const origin = useRef(Symbol("notifications"));
  const runLatest = useRemoteSearch();

  const load = useCallback(async (next: number, size = pageSize, force=false) => {
    if(busy.current&&!force){queuedRefresh.current=true;return false;}
    readController.current?.abort();const controller=new AbortController();readController.current=controller;
    setLoading(true); setError("");
    const request = await runLatest(async signal => {
      const fetchPage = (number: number) => apiFetch<NotificationPage>(`/api/notifications?page=${number}&pageSize=${size}`, { signal });
      let result = await fetchPage(next);
      const validPage = Math.min(next, Math.max(1, Math.ceil(result.total / size)));
      if (validPage !== next) result = await fetchPage(validPage);
      return { ...result, page: validPage };
    },controller.signal);
    if (!request.current||controller.signal.aborted) return false;
    setLoading(false);
    if ("error" in request) { setReadFailed(true);setError(t("nav.notification.loadFailed")); return false; }
    setItems(request.value.items); setTotal(request.value.total);
    setPage(request.value.page); setPageSize(size);
    setReadFailed(false);setRefreshOnly(false);return true;
  }, [pageSize, runLatest, t]);
  useEffect(()=>()=>readController.current?.abort(),[]);

  useEffect(() => {
    if (hasInitial) return;
    // Defer the initial network load; a Strict Mode cleanup cancels this mount.
    const timer = window.setTimeout(() => void load(1), 0);
    return () => window.clearTimeout(timer);
  }, [hasInitial, load]);

  useEffect(() => {
    const refresh = (event: Event) => {
      if ((event as CustomEvent).detail !== origin.current) void load(page);
    };
    window.addEventListener(changedEvent, refresh);
    return () => window.removeEventListener(changedEvent, refresh);
  }, [load, page]);

  const markRead = async (operation: NotificationMutation) => {
    if (busy.current||!canManage||loading||readFailed||refreshOnly) return;
    busy.current = true; setPending(true); setError("");
    readController.current?.abort();setLoading(false);
    try {
      await apiFetch("/api/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(operation) });
      if ("all" in operation) { setItems([]); setTotal(0); }
      else {
        const selected = new Set(operation.ids);
        setItems(current => current.filter(item => !selected.has(item.id)));
        setTotal(current => Math.max(0, current - items.filter(item => selected.has(item.id)).length));
      }
      window.dispatchEvent(new CustomEvent(changedEvent, { detail: origin.current }));
      // A failed refresh never turns an accepted mark into a failed write.
      queuedRefresh.current=false;
      if(!await load(page,pageSize,true))setRefreshOnly(true);
    } catch(caught) {setReadFailed(true);setError(t(isDefinitiveMutationFailure(caught)?"nav.notification.markFailed":"notifications.uncertain"));}
    finally {
      busy.current = false; setPending(false);
      if(queuedRefresh.current){queuedRefresh.current=false;void load(page);}
    }
  };

  return { items, total, page, pageSize, loading, pending, error, load, markRead,canManage,refreshOnly,locked:loading||pending||readFailed||refreshOnly };
}
