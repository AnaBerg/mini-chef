/* eslint-disable @next/next/no-html-link-for-pages */
import { PrivateBoundary } from "@/components/private-boundary";
import { InvitationEntry } from "@/components/invitation-forms";
export const metadata = { referrer: "no-referrer" as const };
export default function InvitationPage() {
  return <PrivateBoundary><main className="mx-auto min-h-svh max-w-2xl px-6 py-16"><a href="/households" className="text-primary">Your households</a><p className="mt-10 text-xs uppercase tracking-widest text-primary">A seat at the table</p><h1 className="mt-3 text-4xl font-semibold">Household invitation</h1><InvitationEntry /></main></PrivateBoundary>;
}
