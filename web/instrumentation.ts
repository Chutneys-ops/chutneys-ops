// Server-side error monitoring with Sentry, ONLY when SENTRY_DSN is set.
// Without it, Sentry is never even loaded. Every event passes through
// lib/sentry-scrub.ts first (no names, emails, IPs or request bodies).
// Setup for the hosted app: docs/RUNBOOK.md > Error monitoring.

import type { Instrumentation } from "next";
import { sentryOptions } from "@/lib/sentry-scrub";

const dsn = process.env.SENTRY_DSN;

export async function register() {
  if (!dsn) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    ...sentryOptions(dsn, process.env.SENTRY_ENVIRONMENT),
    // Never read local variables off the stack (they hold form values).
    includeLocalVariables: false,
  });
}

/** Errors in pages, server actions and route handlers. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!dsn) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(error, request, context);
};
