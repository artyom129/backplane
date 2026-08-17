import { CheckCircle2, Database, Radio, ShieldCheck } from "lucide-react";

import { Logo } from "@/components/brand/Logo";

const signals = [
  { icon: Radio, label: "Webhook ingestion", value: "Listening" },
  { icon: Database, label: "Operations database", value: "Connected" },
  { icon: ShieldCheck, label: "Secrets vault", value: "Encrypted" },
];

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <section className="subtle-grid relative hidden overflow-hidden border-r border-line bg-[#090c0f] p-10 lg:flex lg:flex-col">
        <Logo />
        <div className="my-auto max-w-xl">
          <div className="eyebrow mb-4 text-accent">API & Automation Operations Control Plane</div>
          <h1 className="max-w-lg text-[2.6rem] font-medium leading-[1.08] tracking-[-0.045em] text-ink">
            Know what broke before your users do.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted">
            One operational view for API requests, webhook delivery, background automation and the
            incidents between them.
          </p>
          <div className="panel mt-10 max-w-md overflow-hidden bg-[#0c1014]/95">
            <div className="flex h-11 items-center border-b border-line px-4">
              <div className="flex gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#3a424c]" />
                <span className="h-2 w-2 rounded-full bg-[#3a424c]" />
                <span className="h-2 w-2 rounded-full bg-[#3a424c]" />
              </div>
              <span className="ml-auto font-mono text-[10px] text-muted">acme / payments / prod</span>
            </div>
            <div className="p-2">
              {signals.map(({ icon: Icon, label, value }) => (
                <div className="flex items-center gap-3 rounded-md px-3 py-3" key={label}>
                  <Icon className="h-4 w-4 text-muted" />
                  <span className="text-xs text-[#c7ced5]">{label}</span>
                  <span className="ml-auto flex items-center gap-1.5 text-[11px] text-accent">
                    <CheckCircle2 className="h-3 w-3" /> {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted">Open-source infrastructure for small engineering teams.</p>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[390px]">
          <Logo className="mb-10 lg:hidden" />
          {children}
        </div>
      </section>
    </main>
  );
}

