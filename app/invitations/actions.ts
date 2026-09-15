"use server";
import { DomainError } from "@/lib/domain/commands";
import { householdDetails } from "@/lib/domain/households";
import { createInvitation, revokeInvitation } from "@/lib/domain/invitations";
import { getDomainExecutor, getInvitationService } from "@/lib/domain/server";

// Never log errors containing database parameters or the bearer secret.
export async function previewInvitationAction(token: string) {
  try { return { preview: await getInvitationService().preview(token) }; }
  catch (error) { return error instanceof DomainError && error.code === "UNAUTHENTICATED" ? { preview: null, error: "UNAUTHENTICATED" } : { preview: null }; }
}
export async function acceptInvitationAction(token: string, consent: boolean, retryOnly = false) {
  try {
    const result = await getInvitationService().accept(token, consent, retryOnly);
    if (result.status !== "active") return { error: "ACCESS_DENIED" };
    await householdDetails(getDomainExecutor(), result.householdId);
    return { householdId: result.householdId };
  } catch (error) { return { error: error instanceof DomainError ? error.code : "UNEXPECTED" }; }
}
export async function createInvitationAction(input: { householdId: string; idempotencyKey: string }) {
  try { return await createInvitation(getDomainExecutor(), input); }
  catch (error) { return { error: error instanceof DomainError ? error.code : "UNEXPECTED" }; }
}
export async function revokeInvitationAction(input: { householdId: string; invitationId: string; idempotencyKey: string }) {
  try { await revokeInvitation(getDomainExecutor(), input); return { success: true }; }
  catch (error) { return { error: error instanceof DomainError ? error.code : "UNEXPECTED" }; }
}
