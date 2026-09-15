"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createHouseholdAction, deactivateMemberAction } from "@/app/households/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const errors: Record<string, string> = {
  INVALID_INPUT: "Enter a household name and a supported IANA timezone, such as America/New_York or UTC.",
  UNAUTHENTICATED: "Your session has expired. Sign in again to continue.",
  ACCESS_DENIED: "You no longer have access to this household.",
  NOT_FOUND: "This member is no longer available. Reload the page.",
  LAST_ACTIVE_MEMBER: "The last active member cannot be deactivated. Another account must join first.",
  VERSION_CONFLICT: "This membership changed. Reload the page and review the updated status before confirming again.",
  IDEMPOTENCY_CONFLICT: "This request was already used with different details. Reload before trying again.",
};
const message = (code: string) => errors[code] ?? "Something went wrong. Please try again.";

export function CreateHouseholdForm() {
  const router = useRouter();
  const key = useRef<string | null>(null);
  const previous = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return <form className="space-y-6" onSubmit={async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = { name: String(data.get("name")), timezone: String(data.get("timezone")), includePlannedMeals: data.get("planned") === "yes" };
    const content = JSON.stringify(input);
    if (previous.current !== content) { key.current = crypto.randomUUID(); previous.current = content; }
    setPending(true); setError("");
    try {
      const result = await createHouseholdAction({ ...input, idempotencyKey: key.current! });
      if (result.error) setError(message(result.error));
      else router.push(`/households/${result.householdId}`);
    } catch { setError(message("UNEXPECTED")); }
    finally { setPending(false); }
  }}>
    <div className="space-y-2"><Label htmlFor="name">Household name</Label><Input id="name" name="name" required maxLength={100} placeholder="Our kitchen" /></div>
    <div className="space-y-2"><Label htmlFor="timezone">Timezone</Label><Input id="timezone" name="timezone" required defaultValue="UTC" aria-describedby="timezone-help" /><p id="timezone-help" className="text-sm text-muted-foreground">Use an IANA timezone, such as America/Sao_Paulo. Dates follow your household timezone.</p></div>
    <fieldset className="space-y-3"><legend className="mb-2 font-medium text-sm">Include planned meals in shopping needs?</legend>
      <label className="flex items-center gap-2 text-sm"><input type="radio" name="planned" value="yes" required />Yes, include planned meals</label>
      <label className="flex items-center gap-2 text-sm"><input type="radio" name="planned" value="no" required />No, use consumption only</label>
      <p className="text-sm text-muted-foreground">The planning horizon starts at 7 days.</p>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create household"}</Button>
  </form>;
}

export function DeactivateMemberButton({ householdId, memberId, expectedVersion, name, self, lastActive }: { householdId: string; memberId: string; expectedVersion: number; name: string; self: boolean; lastActive: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const key = useRef<string | null>(null);
  if (lastActive) return <p className="max-w-xs text-sm text-muted-foreground">Last active member. Another account must join before this membership can be deactivated.</p>;
  return <div className="space-y-3">
    {!confirming ? <Button variant="outline" onClick={() => setConfirming(true)}>Deactivate {self ? "your membership" : name}</Button> : <>
      <p className="max-w-sm text-sm">Deactivate {name}? {self ? "You will lose access to this household." : "They will lose access to this household."} History will be preserved. A new invitation is required to join again.</p>
      <div className="flex gap-2"><Button variant="destructive" disabled={pending || conflict} onClick={async () => {
        key.current ??= crypto.randomUUID(); setPending(true); setError("");
        try {
          const result = await deactivateMemberAction({ householdId, memberId, expectedVersion, idempotencyKey: key.current });
          if (result.error) { setError(message(result.error)); setConflict(result.error === "VERSION_CONFLICT"); }
          else if (self) router.push("/households");
          else { setConfirming(false); router.refresh(); }
        } catch { setError(message("UNEXPECTED")); }
        finally { setPending(false); }
      }}>{pending ? "Deactivating…" : "Confirm deactivation"}</Button><Button variant="ghost" disabled={pending} onClick={() => { setConfirming(false); setError(""); }}>Cancel</Button></div>
    </>}
    {error && <p role="alert" className="max-w-sm text-sm text-destructive">{error}</p>}
    {conflict && <Button variant="outline" onClick={() => window.location.reload()}>Reload membership</Button>}
  </div>;
}
