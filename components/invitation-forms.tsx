"use client";
/* Invitation fragments stay in the browser and are submitted only in action bodies. */
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { useInvitationFragment } from "@/lib/invitation-fragment";
import { navigatePrivate } from "@/lib/private-navigation";
import { acceptInvitationAction, createInvitationAction, previewInvitationAction, revokeInvitationAction } from "@/app/invitations/actions";
import { Button } from "@/components/ui/button";

export function InvitationEntry() {
  const fragment = useInvitationFragment();
  return <InvitationConsent key={fragment} fragment={fragment} />;
}
function InvitationConsent({ fragment }: { fragment: string }) {
  const hydrated = useHydrated();
  const [preview, setPreview] = useState<{ name: string } | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  async function run(accept: boolean) {
    if (pending) return;
    setPending(true); setError("");
    try {
      if (accept) {
        const result = await acceptInvitationAction(fragment.slice(1), true, !preview);
        if (result.householdId) { navigatePrivate(`/households/${result.householdId}`); return; }
        setNeedsAuth(result.error === "UNAUTHENTICATED");
        setError(result.error === "UNAUTHENTICATED" ? "Sign in or create an account, then return here to accept." : result.error === "ACCESS_DENIED" ? "Your membership is no longer active. Ask for a new invitation." : "This invitation is unavailable. Ask for a new link.");
      } else {
        const result = await previewInvitationAction(fragment.slice(1));
        setPreview(result.preview);
        setNeedsAuth(result.error === "UNAUTHENTICATED");
        if (result.error === "UNAUTHENTICATED") { setNeedsAuth(true); setError("Sign in or create an account, then return here to preview and accept."); }
        else if (!result.preview) setError("This invitation is unavailable. If you already accepted it, you can check your access below.");
      }
    } catch { setError("Unable to connect. Please try again."); }
    finally { setPending(false); }
  }
  return <div className="mt-6 space-y-5">
    <p className="text-muted-foreground">Review the household before joining. Acceptance shares your account name with its members and gives you equal household permissions.</p>
    <Button disabled={!hydrated || pending || !fragment} onClick={() => run(false)}>Preview invitation</Button>
    {preview && <div className="rounded-xl border bg-background p-5"><p className="text-sm text-muted-foreground">You are invited to</p><h2 className="mt-2 break-words text-2xl font-medium">{preview.name}</h2></div>}
    {error && <p role="alert">{error}</p>}
    <div><Button disabled={!hydrated || pending || !fragment} onClick={() => run(true)}>{pending ? "Please wait…" : preview ? "Accept invitation and join" : "Check previous acceptance"}</Button></div>
    {needsAuth && <p className="text-sm"><a className="text-primary underline" href={`/sign-in${fragment}`}>Sign in</a> or <a className="text-primary underline" href={`/sign-up${fragment}`}>create an account</a> to accept. Your invitation will be preserved.</p>}
    {!fragment && hydrated && <p role="alert">Open the complete invitation link to continue.</p>}
  </div>;
}
export function InvitationManager({ householdId, invitations }: { householdId: string; invitations: { id: string; expiresAt: string }[] }) {
  const hydrated = useHydrated();
  const [key, setKey] = useState<string | null>(null);
  const [link, setLink] = useState<{ invitationId: string; value: string } | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  const [created, setCreated] = useState<{ id: string; expiresAt: string }[]>([]);
  async function create() {
    if (pending) return;
    const requestKey = key ?? crypto.randomUUID(); setKey(requestKey); setPending(true); setError("");
    try {
      const result = await createInvitationAction({ householdId, idempotencyKey: requestKey });
      if ("error" in result) { setError("Unable to create invitation. Reload to check your access."); return; }
      setCreated((items) => items.some((item) => item.id === result.invitationId) ? items : [{ id: result.invitationId, expiresAt: result.expiresAt }, ...items]);
      if (result.token) setLink({ invitationId: result.invitationId, value: `${window.location.origin}/invitations#${result.token}` });
      if (!result.token) setError("This request already created an invitation. Its secret cannot be recovered. Revoke it below and create a new link.");
      setKey(null);
    } catch { setError("Unable to connect. Retry to check the same request."); }
    finally { setPending(false); }
  }
  async function revoke(id: string) {
    if (pending) return;
    setPending(true); setError("");
    try {
      const result = await revokeInvitationAction({ householdId, invitationId: id, idempotencyKey: crypto.randomUUID() });
      if (result.error) setError("Unable to revoke invitation. Reload to check whether it was already accepted.");
      else { setRemoved((items) => [...items, id]); setLink((current) => current?.invitationId === id ? null : current); }
    } catch { setError("Unable to connect. Please try again."); }
    finally { setPending(false); }
  }
  return <div className="mt-6 space-y-6"><p className="max-w-xl text-muted-foreground">Anyone with a link can join after signing in and accepting. Links expire in seven days and can be used once. Share only with someone you want in this household.</p>
    <Button disabled={!hydrated || pending} onClick={create}>{pending ? "Please wait…" : "Create invitation link"}</Button>
    {link && <div className="space-y-2 rounded-xl border bg-background p-5"><label htmlFor="invitation-link" className="font-medium">Your invitation link</label><input id="invitation-link" className="w-full rounded border p-3 text-sm" readOnly value={link.value} onFocus={(event) => event.currentTarget.select()} /><p className="text-sm text-muted-foreground">Copy this link now. It is shown only once and cannot be recovered after leaving this page.</p></div>}
    {error && <p role="alert">{error}</p>}
    <h2 className="text-xl font-medium">Unused invitations</h2><ul className="space-y-3">{[...created, ...invitations].filter((item) => !removed.includes(item.id)).map((item) => <li key={item.id} className="flex items-center justify-between gap-4 rounded-xl border bg-background p-5"><p className="text-sm">Expires {new Date(item.expiresAt).toLocaleDateString("en-US", { timeZone: "UTC" })}</p><Button variant="outline" disabled={!hydrated || pending} onClick={() => revoke(item.id)}>Revoke</Button></li>)}</ul>
  </div>;
}
