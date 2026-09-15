import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DeactivateMemberButton } from "@/components/household-forms";
import { Card, CardContent } from "@/components/ui/card";
import { DomainError } from "@/lib/domain/commands";
import { householdDetails } from "@/lib/domain/households";
import { getDomainExecutor } from "@/lib/domain/server";

export default async function MembersPage({ params }: { params: Promise<{ householdId: string }> }) {
  // Resolve request context before initializing database-backed services.
  await headers();
  const { householdId } = await params;
  let home;
  try { home = await householdDetails(getDomainExecutor(), householdId); }
  catch (error) {
    if (!(error instanceof DomainError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/sign-in");
    return <main className="mx-auto max-w-3xl px-6 py-16"><h1 className="text-3xl font-semibold">Household unavailable</h1><p className="my-4 text-muted-foreground">You do not have active access to this household.</p><Link href="/households" className="text-primary">Back to your households</Link></main>;
  }
  const activeCount = home.members.filter((member) => member.status === "active").length;
  return <main className="min-h-svh bg-muted/30 px-6 py-10 sm:px-10"><div className="mx-auto max-w-5xl">
    <Link href="/households" className="text-sm text-primary">← Your households</Link>
    <p className="mt-10 text-xs font-medium uppercase tracking-[0.2em] text-primary">Your household</p><h1 className="mt-3 break-words text-4xl font-semibold tracking-tight">{home.name}</h1><p className="mt-3 text-muted-foreground">{home.timezone} · {activeCount} active {activeCount === 1 ? "member" : "members"}</p>
    <h2 className="mt-10 text-xl font-medium">Members</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">All active members have equal permissions. Deactivated members lose access, while their membership and history stay intact.</p>
    <ul className="mt-6 space-y-4">{home.members.map((member) => <li key={member.id}><Card><CardContent className="flex flex-col justify-between gap-5 py-6 sm:flex-row sm:items-center"><div><h3 className="font-medium">{member.name}{member.id === home.actorMemberId ? " (you)" : ""}</h3><p className="mt-1 text-sm capitalize text-muted-foreground">{member.status}</p></div>{member.status === "active" && <DeactivateMemberButton key={`${member.id}-${member.version}`} householdId={householdId} memberId={member.id} expectedVersion={member.version} name={member.name} self={member.id === home.actorMemberId} lastActive={activeCount === 1} />}</CardContent></Card></li>)}</ul>
  </div></main>;
}
