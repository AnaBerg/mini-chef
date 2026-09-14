import { ArrowUpRight, ChefHat, Sprout } from "lucide-react";
import Link from "next/link";

import { cn } from "cn";

import { buttonVariants } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="min-h-svh bg-background px-6 sm:px-10">
      <header className="mx-auto flex max-w-6xl items-center justify-between py-7">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold"><ChefHat className="size-5 text-primary" aria-hidden="true" />Mini Chef</Link>
        <Link href="/sign-in" className={buttonVariants({ variant: "outline" })}>Sign in</Link>
      </header>
      <section className="mx-auto grid min-h-[75svh] max-w-6xl items-center gap-12 py-16 md:grid-cols-[1.2fr_1fr] md:gap-20">
        <div>
          <p className="mb-6 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-primary"><Sprout className="size-4" aria-hidden="true" />Good things start small</p>
          <h1 className="text-7xl font-semibold tracking-[-0.065em] sm:text-8xl lg:text-9xl">Mini Chef</h1>
          <p className="mt-7 max-w-md text-xl leading-relaxed text-muted-foreground">A little space for your kitchen.<br />A fresh start for what comes next.</p>
          <Link href="/sign-up" className={cn(buttonVariants(), "mt-9 h-12 gap-6 px-6")}>Create account<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
        </div>
        <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[3rem] bg-primary/10" aria-hidden="true">
          <div className="absolute -right-12 -top-12 size-48 rounded-full border border-primary/15" />
          <div className="absolute -bottom-24 -left-12 size-72 rounded-full border border-primary/15" />
          <div className="flex size-3/4 items-center justify-center rounded-full border border-primary/15 bg-background/70 shadow-[0_25px_60px_-30px_var(--primary)]">
            <div className="flex size-3/4 items-center justify-center rounded-full border border-primary/15"><ChefHat className="size-28 text-primary" strokeWidth={1} /></div>
          </div>
          <span className="absolute bottom-8 text-xs uppercase tracking-[0.25em] text-primary">Make yourself at home</span>
        </div>
      </section>
      <footer className="mx-auto max-w-6xl border-t py-6 text-xs text-muted-foreground">A little inspiration. A lot of possibility.</footer>
    </main>
  );
}
