/* eslint-disable @next/next/no-html-link-for-pages */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PrivateBoundary } from "@/components/private-boundary";
import { InvitationManager } from "@/components/invitation-forms";
import { getDomainExecutor } from "@/lib/domain/server";
import { listInvitations } from "@/lib/domain/invitations";
import { householdDetails } from "@/lib/domain/households";
import { DomainError } from "@/lib/domain/commands";
export default async function InvitationsPage({ params }: { params: Promise<{ householdId: string }> }) {
  await headers(); const { householdId } = await params;
  let invitations;
  let timezone;
  try {
    const executor = getDomainExecutor();
    invitations = await listInvitations(executor, householdId);
    ({ timezone } = await householdDetails(executor, householdId));
  }
  catch (error) {
    if (!(error instanceof DomainError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/sign-in");
    return <PrivateBoundary><main className="mx-auto max-w-2xl p-10"><h1>Household unavailable</h1><a href="/households">Your households</a></main></PrivateBoundary>;
  }
  return <PrivateBoundary><main className="mx-auto min-h-svh max-w-3xl px-6 py-16"><a className="text-primary" href={`/households/${householdId}`}>← Back to members</a><h1 className="mt-10 text-4xl font-semibold">Invite someone home</h1><InvitationManager householdId={householdId} timezone={timezone} invitations={invitations.map((item) => ({ id: item.id, expiresAt: item.expiresAt.toISOString() }))} /></main></PrivateBoundary>;
}
