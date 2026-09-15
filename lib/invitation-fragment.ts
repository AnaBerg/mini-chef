"use client";
import { useSyncExternalStore } from "react";
const subscribe = (notify: () => void) => { window.addEventListener("hashchange", notify); return () => window.removeEventListener("hashchange", notify); };
export function useInvitationFragment() {
  return useSyncExternalStore(subscribe, () => /^#[A-Za-z0-9_-]{43}$/.test(window.location.hash) ? window.location.hash : "", () => "");
}
