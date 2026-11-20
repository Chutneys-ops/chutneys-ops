import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/logo-mark";

// /privacy: what Chutneys Ops records about staff, why, who sees it, how
// long it's kept and how to ask for it. Public (no sign-in needed), so
// someone deciding whether to join, or who has left, can read it too.
// Keep it in step with SECURITY.md and the database when things change.

export const metadata: Metadata = {
  title: "Privacy | Chutneys Ops",
  description: "What Chutneys Ops records about staff, why, who can see it and how long it's kept.",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 rounded-[14px] border border-line bg-white p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-2 text-[15px] text-ink">{children}</div>
    </section>
  );
}

type Row = { what: string; why: string; who: string };

const RECORDS: Row[] = [
  {
    what: "Your name, work email and role",
    why: "So you can sign in and people know who did what",
    who: "Everyone at work sees names; emails: you, your managers and the owner",
  },
  {
    what: "Which site you chose each day",
    why: "So you can add that site's records, and for reminders",
    who: "You, managers, the owner",
  },
  {
    what: "Food safety records you enter or sign (temperatures, checks, cleaning, deliveries)",
    why: "The law (Food Act 2014) requires them, with who did each one",
    who: "Staff at that site that day, managers, the owner, and the council's food safety verifier",
  },
  {
    what: "Hours you work, rosters and timesheets",
    why: "To pay you correctly and keep the wage and time record the law requires",
    who: "You, managers, the owner. Coworkers see only who is on with them",
  },
  {
    what: "Sick leave requests, including whether you had vomiting or diarrhoea, and any medical certificate",
    why: "Sick leave pay, and food safety: people with those symptoms can't handle food until 48 hours clear",
    who: "You, managers, the owner. The verifier pack lists only names and dates sick and cleared, never the reason or certificate",
  },
  {
    what: "Training records and your signature (if you drew one)",
    why: "To show you were trained, as the food control plan requires",
    who: "You, managers, the owner, the verifier",
  },
  {
    what: "Purchases you make and their receipts",
    why: "GST, paying you back, and the accounts",
    who: "You, managers, the owner and the accountant",
  },
  {
    what: "Payslips and your payroll code",
    why: "So you can see your pay",
    who: "Only you and the owner. Not managers",
  },
  {
    what: "Notices you've read and acknowledged",
    why: "To show important notices reached everyone",
    who: "You, managers, the owner",
  },
  {
    what: "Sign-in details: when you last signed in, two-step devices you named, phones with notifications on",
    why: "Security, and sending notifications to the right phone",
    who: "You; the owner sees when people last signed in and how many two-step devices they have",
  },
  {
    what: "A log of every change (who changed what, and when)",
    why: "So mistakes and misuse can be traced",
    who: "Only the owner",
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="flex items-center gap-3">
        <LogoMark size="lg" />
        <div>
          <h1 className="text-3xl font-bold">Your privacy</h1>
          <p className="text-sm text-muted">What Chutneys Ops records about you, and your rights.</p>
        </div>
      </div>

      <Section title="In short">
        <p>
          Chutneys Ops records what we need to run the sites safely, pay you and meet the law. It doesn&apos;t
          track where you are, doesn&apos;t use your camera or microphone except when you choose to take a photo of a
          receipt or certificate, and doesn&apos;t sell or share your information for advertising.
        </p>
        <p>
          The New Zealand Privacy Act 2020 applies. Chutneys is responsible for your information, including the
          parts stored by the companies that run the app for us (below).
        </p>
      </Section>

      <Section title="What we record, why, and who can see it">
        <ul className="divide-y divide-line">
          {RECORDS.map((r) => (
            <li key={r.what} className="py-3 first:pt-0 last:pb-0">
              <p className="font-semibold">{r.what}</p>
              <p className="text-sm">
                <span className="text-muted">Why: </span>
                {r.why}
              </p>
              <p className="text-sm">
                <span className="text-muted">Who sees it: </span>
                {r.who}
              </p>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          Managers see records for every site. The owner sees everything, including money. The database itself
          enforces these rules, not just the screens.
        </p>
      </Section>

      <Section title="How long it's kept">
        <ul className="list-disc space-y-1 pl-5">
          <li>Hours, wages, leave and holiday records: at least 6 years, as employment law requires.</li>
          <li>Tax and purchase records: at least 7 years, as tax law requires.</li>
          <li>Food safety records and training: at least 4 years, for the food control plan.</li>
          <li>
            Everything else (notices, rosters, the change log): kept for now. The owner is deciding a fixed period,
            and this page will say it once decided.
          </li>
          <li>When you leave, your account is turned off: you can&apos;t sign in, but your records stay for the periods above.</li>
        </ul>
      </Section>

      <Section title="Where it's stored and who runs it for us">
        <ul className="list-disc space-y-1 pl-5">
          <li>Supabase (database, sign-in and files), in its Sydney, Australia data centre.</li>
          <li>Our web host, which runs the app&apos;s pages.</li>
          <li>
            If error monitoring is on, Sentry receives error details with names, emails, IP addresses and anything
            you typed removed first.
          </li>
        </ul>
        <p>They store and process it for us; they may not use it for anything else.</p>
      </Section>

      <Section title="Keeping it safe">
        <p>
          Everything travels encrypted. Owners and managers must use two-step sign-in (a code from a phone app);
          you can turn it on too in Settings. Shared tablets sign out after 15 minutes without use. Receipts,
          certificates and payslips are private files opened through links that expire within minutes.
        </p>
        <p>
          If a breach is likely to cause you serious harm, we&apos;ll tell you and the Privacy Commissioner as soon
          as we can.
        </p>
      </Section>

      <Section title="Seeing or correcting your information">
        <p>
          You can ask for a copy of the information we hold about you, and ask us to correct anything that&apos;s
          wrong. It&apos;s free. Ask the owner, who is Chutneys&apos; privacy officer, in person or in writing.
          We&apos;ll reply within 20 working days.
        </p>
        <p>
          Records can&apos;t be edited after they&apos;re saved (so they can be trusted), so a correction is added as
          a note alongside the original.
        </p>
        <p>
          If you&apos;re not happy with how we handle it, you can complain to the Office of the Privacy Commissioner:{" "}
          <a href="https://www.privacy.org.nz" className="font-medium text-primary underline" rel="noopener noreferrer" target="_blank">
            privacy.org.nz
          </a>
          .
        </p>
      </Section>

      <p className="mt-6 text-center text-sm">
        <Link href="/home" className="font-medium text-primary">
          Back to Chutneys Ops
        </Link>
      </p>
    </main>
  );
}
