"use client";

import { useHydrated } from "@/lib/use-hydrated";

import Link from "next/link";
import { navigatePrivate } from "@/lib/private-navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const hydrated = useHydrated();
  const isSignUp = mode === "sign-up";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    setPending(true);
    setError(null);

    try {
      const result = isSignUp
        ? await authClient.signUp.email({
            name: String(data.get("name") ?? "").trim(),
            email,
            password,
          })
        : await authClient.signIn.email({ email, password });

      if (result.error) {
        setError(result.error.message || "We couldn't complete your request. Please try again.");
        return;
      }

      navigatePrivate("/dashboard");
    } catch {
      setError("Unable to connect. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-6 py-12">
      <Link href="/" className="mb-8 text-sm font-semibold tracking-tight">Mini Chef</Link>
      <Card className="w-full max-w-md p-3 sm:p-5">
        <CardHeader className="gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">A seat at the table</p>
          <h1 className="text-3xl font-semibold tracking-tight">{isSignUp ? "Create your account" : "Welcome back"}</h1>
          <CardDescription>
            {isSignUp ? "Make yourself at home in your own little kitchen." : "Sign in to return to your kitchen."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5" aria-busy={pending}>
            <fieldset disabled={pending} className="space-y-5">
              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" autoComplete="name" required maxLength={100} className="h-11" />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required className="h-11" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" autoComplete={isSignUp ? "new-password" : "current-password"} required minLength={8} maxLength={128} className="h-11" aria-describedby={isSignUp ? "password-hint" : undefined} />
                {isSignUp && <p id="password-hint" className="text-xs text-muted-foreground">Use at least 8 characters.</p>}
              </div>
            </fieldset>
            {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={!hydrated || pending} className="h-11 w-full">
              {pending ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
            </Button>
          </form>
          <p role="status" className="sr-only">{pending ? "Please wait…" : ""}</p>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {isSignUp ? "Already have an account? " : "New to Mini Chef? "}
            <Link href={isSignUp ? "/sign-in" : "/sign-up"} className="font-medium text-foreground underline underline-offset-4">
              {isSignUp ? "Sign in" : "Create account"}
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
