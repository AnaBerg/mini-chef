import { ChefHat, Sprout } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/sign-out-button";
import { Card, CardContent } from "@/components/ui/card";
import { getAuth } from "@/lib/auth";

export default async function DashboardPage() {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) redirect("/sign-in");

  return (
    <main className="min-h-svh bg-muted/30 px-6 sm:px-10">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 border-b py-7">
        <Link href="/" className="flex items-center gap-2 font-semibold"><ChefHat className="size-5 text-primary" aria-hidden="true" />Mini Chef</Link>
        <SignOutButton />
      </header>
      <section className="mx-auto max-w-5xl py-16 sm:py-24">
        <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-primary">Make yourself at home</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Your kitchen</h1>
        <p className="mt-4 text-muted-foreground">Welcome, {session.user.name}.</p>
        <p className="mt-1 break-all text-sm text-muted-foreground">{session.user.email}</p>
        <Card className="mt-10 border border-dashed bg-background/60 shadow-none ring-0">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Sprout className="mb-5 size-8 text-primary" strokeWidth={1.5} aria-hidden="true" />
            <h2 className="text-lg font-medium">Room for something good</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Your account is ready. This is where your Mini Chef journey begins.</p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
