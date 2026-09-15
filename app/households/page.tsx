import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CreateHouseholdForm } from "@/components/household-forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DomainError } from "@/lib/domain/commands";
import { getHouseholdService } from "@/lib/domain/server";

export default async function HouseholdsPage() {
  // Resolve request context before initializing database-backed services.
  await headers();
  const homes = await getHouseholdService().list().catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    throw error;
  });
  return <main className="min-h-svh bg-muted/30 px-6 py-10 sm:px-10"><div className="mx-auto max-w-5xl">
    <Link href="/dashboard" className="text-sm text-primary">← Your kitchen</Link>
    <p className="mt-10 text-xs font-medium uppercase tracking-[0.2em] text-primary">A place to cook together</p>
    <h1 className="mt-3 text-4xl font-semibold tracking-tight">Your households</h1>
    <div className="mt-10 grid items-start gap-8 md:grid-cols-2">
      <section><h2 className="mb-4 text-xl font-medium">Your kitchens</h2>{homes.length ? <ul className="space-y-3">{homes.map((home) => <li key={home.id}><Link className="block break-words rounded-xl border bg-background p-5 font-medium hover:border-primary" href={`/households/${home.id}`}>{home.name}<span className="mt-1 block text-sm font-normal text-muted-foreground">View members →</span></Link></li>)}</ul> : <p className="text-muted-foreground">No active households yet. Create one to start cooking together.</p>}<p className="mt-6 text-sm leading-relaxed text-muted-foreground">Every member has an account and equal permissions. Deactivating a membership preserves its history.</p></section>
      <Card><CardHeader><CardTitle>Create a household</CardTitle></CardHeader><CardContent><CreateHouseholdForm /></CardContent></Card>
    </div>
  </div></main>;
}
