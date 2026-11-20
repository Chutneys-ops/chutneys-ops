"use client";

// Settings > This device: "This is a shared device" switch. Remembered in
// this browser only, because it's about the tablet, not the person.

import { useState } from "react";
import { setSharedDevice, useSharedDevice } from "@/components/shared-device";
import { deviceModeText } from "@/lib/shared-device";

export function DeviceMode() {
  const shared = useSharedDevice();
  const [problem, setProblem] = useState<string | null>(null);

  if (shared === null) return <p className="text-sm text-muted">Checking this device…</p>;
  const text = deviceModeText(shared);

  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-cream px-3 py-2 text-sm" role="status">
        <span className="font-semibold text-ink">Now: {text.title}.</span>{" "}
        <span className="text-muted">{text.detail}</span>
      </p>
      <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border border-line px-3">
        <span className="text-[15px] font-semibold text-ink">This is a shared device</span>
        <input
          id="shared-device"
          type="checkbox"
          checked={shared}
          onChange={(e) => {
            const ok = setSharedDevice(e.target.checked);
            setProblem(ok ? null : "This browser won't remember settings (private mode?), so this can't be switched on.");
          }}
          className="h-6 w-6 accent-primary"
        />
      </label>
      {problem && (
        <p role="alert" className="rounded-xl bg-warning-light px-3 py-2 text-sm font-medium text-warning">
          {problem}
        </p>
      )}
    </div>
  );
}
