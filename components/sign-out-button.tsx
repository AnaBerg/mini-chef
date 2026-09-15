"use client";

import { useHydrated } from "@/lib/use-hydrated";

import { navigatePrivate } from "@/lib/private-navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setPending(true);
    setError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError("Sign-out is unconfirmed. Please try again.");
        return;
      }
      navigatePrivate("/sign-in");
    } catch {
      setError("Sign-out is unconfirmed. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="outline" onClick={signOut} disabled={!hydrated || pending}>{pending ? "Signing out…" : "Sign out"}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
