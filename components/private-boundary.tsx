"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { isReplacingPrivateDocument, reloadPrivate, sessionChannel } from "@/lib/private-navigation";

/** Hide private snapshots before history caching; restore only through a fresh server read. */
export function PrivateBoundary({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current!;
    const hide = () => { element.style.visibility = "hidden"; };
    const revalidate = () => { hide(); reloadPrivate(); };
    // Some browsers restore HTML from their HTTP history cache without BFCache.
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation?.type === "back_forward") revalidate();
    else element.style.visibility = "visible";
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) { hide(); reloadPrivate(); }
    };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(sessionChannel);
    if (channel) channel.onmessage = () => {
      // A second channel in this document receives our own signal too. Its reload
      // must not cancel an in-progress replacement to the new destination.
      if (!isReplacingPrivateDocument()) revalidate();
    };
    window.addEventListener("popstate", revalidate);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    return () => {
      channel?.close();
      window.removeEventListener("popstate", revalidate);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
    };
  }, []);
  return <div ref={container} style={{ visibility: "hidden" }}>{children}</div>;
}
