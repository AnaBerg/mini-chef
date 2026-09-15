"use server";

import { DomainError, deactivateMember } from "@/lib/domain/commands";
import { type CreationInput, householdDetails, isUuid } from "@/lib/domain/households";
import { getDomainExecutor, getHouseholdService } from "@/lib/domain/server";

export async function createHouseholdAction(input: CreationInput) {
  try {
    const result = await getHouseholdService().create(input);
    // Historical retries cannot select a household after membership was removed.
    await householdDetails(getDomainExecutor(), result.householdId);
    return { householdId: result.householdId };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    console.error("Household creation failed", error);
    return { error: "UNEXPECTED" };
  }
}

export async function deactivateMemberAction(input: { householdId: string; memberId: string; expectedVersion: number; idempotencyKey: string }) {
  try {
    if (!isUuid(input.householdId) || !isUuid(input.memberId) || !isUuid(input.idempotencyKey)) throw new DomainError("INVALID_INPUT");
    await deactivateMember(getDomainExecutor(), input);
    return { success: true };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    console.error("Member deactivation failed", error);
    return { error: "UNEXPECTED" };
  }
}
