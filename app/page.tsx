import Link from "next/link";
import { auth } from "@/app/src/lib/auth";
import { redirect } from "next/navigation";
import { Button } from "@/app/src/components/client";
import { BrandLockup } from "@/app/src/components/BrandLockup";
import { releaseStage, releaseStageLabels } from "@/app/src/lib/releaseStage";

const perspectives = [
  { number: "01", title: "People", description: "Keep your members and leadership context together." },
  { number: "02", title: "Participation", description: "See contribution over time, beyond a single result." },
  { number: "03", title: "Perspective", description: "Bring metrics and leadership observations into the same conversation." },
];

export default async function HomePage() {
  const session = await auth();
  if (session?.user) redirect("/app");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 sm:px-8 lg:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-6 sm:py-8">
        <BrandLockup />
      </header>

      <main className="grid flex-1 items-center gap-10 py-10 sm:py-16 lg:grid-cols-[1.25fr_1fr] lg:gap-x-20 lg:gap-y-8">
        <section aria-labelledby="welcome-heading" className="lg:self-end">
          <p className="brand-kicker mb-5">Built for Last War leadership</p>
          <h1 id="welcome-heading" className="max-w-xl text-4xl font-semibold leading-[1.12] tracking-tight text-text-primary sm:text-5xl">
            Know your people.<br />
            <span className="text-primary">Lead with confidence.</span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-text-secondary sm:text-lg">
            Connect participation, progress, and the context behind every decision. One shared view of your alliance, built for the people leading it.
          </p>

        </section>

        <section aria-labelledby="entry-heading" className="overflow-hidden rounded-2xl border border-border bg-surface lg:col-start-2 lg:row-start-1 lg:row-span-2">
          <div aria-hidden="true" className="brand-rule" />
          <div className="p-6 sm:p-8">
            <p className="brand-kicker mb-3">Your command center</p>
            <h2 id="entry-heading" className="text-2xl font-semibold tracking-tight text-text-primary">Bring your leadership together.</h2>
            <p className="mb-7 mt-3 text-sm leading-relaxed text-text-muted">Sign in to pick up where your alliance left off.</p>
            <Button href="/login" variant="primary" fullWidth size="lg">Sign In</Button>

            <div className="my-7 border-t border-border" />
            <h3 className="mb-2 text-sm font-medium text-text-primary">Have a beta code?</h3>
            <p className="mb-4 text-sm text-text-muted">Use your invitation to get started.</p>
            <Button href="/redeem" variant="secondary" fullWidth size="lg">Redeem Invitation</Button>

            <div className="mt-7 rounded-xl bg-surface-secondary p-4">
              <h3 className="text-sm font-medium text-text-primary">Lead an alliance?</h3>
              <p className="mb-3 mt-1 text-sm leading-relaxed text-text-muted">We’re welcoming leadership teams into {releaseStageLabels[releaseStage].toLowerCase()}.</p>
              <Link href="/request-access" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
                Request Beta Access <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </section>
        <div className="lg:col-start-1 lg:row-start-2 lg:self-start">
          <div aria-hidden="true" className="brand-rule mb-6 w-16" />
          <ol className="space-y-5">
            {perspectives.map(({ number, title, description }) => (
              <li key={number} className="flex gap-4">
                <span aria-hidden="true" className="pt-0.5 font-mono text-xs text-primary">{number}</span>
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
                  <p className="mt-1 max-w-sm text-sm leading-relaxed text-text-muted">{description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </main>

      <footer className="flex flex-wrap justify-between gap-3 border-t border-border py-5 text-xs text-text-muted">
        <span>Alliance Command Center</span>
        <span>A shared view. A stronger alliance.</span>
      </footer>
    </div>
  );
}
