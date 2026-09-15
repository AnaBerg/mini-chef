import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DomainError } from "@/lib/domain/commands";
import { getHouseholdService } from "@/lib/domain/server";

export default async function DashboardPage() {
  await headers();
  const homes = await getHouseholdService().list().catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    throw error;
  });
  redirect(homes.length === 1 ? `/households/${homes[0].id}` : "/households");
}
