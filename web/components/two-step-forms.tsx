"use client";

// Two-step sign-in forms: set up an authenticator (QR code, then a code),
// type a code, remove a device. Used on /mfa and in Settings.

import { useActionState, useState, useTransition } from "react";
import { FormMessage } from "@/components/password-field";
import { removeDevice, startEnrol, verifyCode, type CodeState, type EnrolStart } from "@/app/mfa/actions";
import { groupSecret } from "@/lib/mfa";

const inputClass =
  "mt-1.5 min-h-12 w-full rounded-xl border border-muted bg-white px-3 text-base text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";
const codeInputClass = `${inputClass} text-center font-display text-2xl tracking-[0.3em]`;
const primaryButton =
  "min-h-12 w-full rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70";
const secondaryButton =
  "min-h-12 w-full rounded-xl border border-line bg-white px-4 font-semibold text-ink hover:border-muted disabled:cursor-wait disabled:opacity-70";

const initial: CodeState = { seq: 0 };

/** The 6-digit box. one-time-code lets phones offer the code themselves. */
function CodeInput({ id }: { id: string }) {
  return (
    <input
      id={id}
      name="code"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9 \-]{6,7}"
      maxLength={7}
      required
      placeholder="000000"
      className={codeInputClass}
    />
  );
}

/** Set up an authenticator: name it, scan the QR code (or type the key),
 *  then type the code it shows. `next`: where to go after. */
export function EnrolForm({ next, firstDevice }: { next: string; firstDevice: boolean }) {
  const [started, setStarted] = useState<Extract<EnrolStart, { ok: true }> | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();
  const [state, verifyAction, verifying] = useActionState(verifyCode, initial);
  const [showKey, setShowKey] = useState(false);

  if (!started) {
    return (
      <form
        action={(formData) =>
          startTransition(async () => {
            const result = await startEnrol(formData);
            if (result.ok) setStarted(result);
            else setStartError(result.message);
          })
        }
        className="space-y-4"
      >
        <div>
          <label htmlFor="device-name" className="block text-sm font-semibold text-ink">
            Name this device <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="device-name"
            name="name"
            maxLength={40}
            autoComplete="off"
            placeholder={firstDevice ? "My phone" : "Spare phone, tablet…"}
            className={inputClass}
          />
        </div>
        <button type="submit" disabled={starting} className={primaryButton}>
          {starting ? "Getting a QR code…" : firstDevice ? "Set up my authenticator" : "Add a device"}
        </button>
        <FormMessage message={startError ?? undefined} />
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
        <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
        <li>Add an account and scan this QR code.</li>
        <li>Type the 6-digit code it shows.</li>
      </ol>
      <div className="flex justify-center rounded-xl border border-line bg-white p-3">
        {/* A data: URL made on the server; next/image adds nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={started.qr} alt="QR code for your authenticator app" width={200} height={200} />
      </div>
      {showKey ? (
        <p className="rounded-xl bg-cream p-3 text-center text-sm">
          <span className="block text-muted">Setup key (choose &quot;time-based&quot;)</span>
          <span className="font-mono text-base font-semibold break-all text-ink select-all">{groupSecret(started.secret)}</span>
        </p>
      ) : (
        <button type="button" onClick={() => setShowKey(true)} className="w-full text-sm font-medium text-primary">
          Can&apos;t scan it? Type a key instead
        </button>
      )}
      <form action={verifyAction} className="space-y-3">
        <input type="hidden" name="factorId" value={started.factorId} />
        <input type="hidden" name="next" value={next} />
        <label htmlFor="enrol-code" className="block text-sm font-semibold text-ink">
          Code from {started.name}
        </label>
        <CodeInput id="enrol-code" />
        <button type="submit" disabled={verifying} className={primaryButton}>
          {verifying ? "Checking…" : "Check code and finish"}
        </button>
        <FormMessage ok={state.ok} message={state.message} />
      </form>
    </div>
  );
}

/** Signing in: type the code from any of your devices. */
export function VerifyForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(verifyCode, initial);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="verify-code" className="block text-sm font-semibold text-ink">
        6-digit code
      </label>
      <CodeInput id="verify-code" />
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? "Checking…" : "Continue"}
      </button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}

/** Settings: remove one device, after a second tap that says what happens. */
export function RemoveDeviceForm({ factorId, name, warning }: { factorId: string; name: string; warning: string }) {
  const [state, action, pending] = useActionState(removeDevice, initial);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-2">
      {confirming ? (
        <form
          action={(formData) => {
            setConfirming(false);
            action(formData);
          }}
          className="space-y-3 rounded-xl border border-warning/30 bg-warning-light p-3"
        >
          <input type="hidden" name="factorId" value={factorId} />
          <p className="text-sm text-ink">
            <span className="font-semibold">Remove {name}?</span> {warning}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirming(false)} className={secondaryButton}>
              Cancel
            </button>
            <button type="submit" className={secondaryButton}>
              Yes, remove
            </button>
          </div>
        </form>
      ) : (
        <button type="button" disabled={pending} onClick={() => setConfirming(true)} className={`${secondaryButton} w-auto px-3 text-sm`}>
          {pending ? "Removing…" : "Remove"}
        </button>
      )}
      <FormMessage ok={state.ok} message={state.message} />
    </div>
  );
}
