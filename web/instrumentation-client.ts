// Browser-side error monitoring with Sentry, ONLY when SENTRY_DSN was set at
// build time (next.config.ts copies it into NEXT_PUBLIC_SENTRY_DSN; a DSN is
// meant to be public). Without it, the Sentry code is never downloaded: the
// import below is a separate file the browser only fetches when needed.
// Every event passes through lib/sentry-scrub.ts first.

import { sentryOptions } from "@/lib/sentry-scrub";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.init({
        ...sentryOptions(dsn, process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT),
        // No session replay or user feedback widgets: they record screens.
        integrations: (defaults) => defaults.filter((i) => i.name !== "Replay" && i.name !== "Feedback"),
      });
    })
    .catch(() => {
      // Monitoring must never break the app.
    });
}
