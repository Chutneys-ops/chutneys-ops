"use client";

// "Confirm" on a training record, with an optional drawn signature.
//
// Logging in is your signature, so "Confirm" alone is enough. "Add a drawn
// signature" opens a small pad (a <canvas> with pointer events, so a finger,
// mouse or pen works); "Sign" uploads it as a PNG to your own folder of the
// private "signatures" bucket, then confirms.

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { newFileId } from "@/lib/uploads";
import { confirmTraining, type ConfirmResult } from "./actions";

// Keep in step with the canvas's h-[160px] class below.
const PAD_HEIGHT = 160;

function SignaturePad({ onSign, busy }: { onSign: (png: Blob) => void; busy: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  // Size the canvas to its box, times the screen's pixel ratio, so lines are sharp.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(PAD_HEIGHT * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1f2a24";
  }, []);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function down(event: PointerEvent<HTMLCanvasElement>) {
    const ctx = event.currentTarget.getContext("2d");
    if (!ctx) return;
    // Keep getting moves even if the finger slides off the pad.
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1); // a tap leaves a dot
    ctx.stroke();
    setEmpty(false);
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = event.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function up() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
  }

  function sign() {
    canvasRef.current?.toBlob((blob) => {
      if (blob) onSign(blob);
    }, "image/png");
  }

  return (
    <div className="mt-3">
      <p className="text-sm text-muted" id="pad-help">
        Sign with your finger in the box.
      </p>
      <canvas
        ref={canvasRef}
        aria-label="Signature pad"
        aria-describedby="pad-help"
        // h-[160px] = PAD_HEIGHT (a class, not style={}, so the Content
        // Security Policy needs no inline styles). touch-none: drawing
        // mustn't scroll the page.
        className="mt-1.5 block h-[160px] w-full touch-none rounded-xl border border-line bg-white"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={clear}
          disabled={busy || empty}
          className="min-h-12 rounded-xl border border-line bg-white px-4 font-semibold text-ink hover:border-muted disabled:opacity-60"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={sign}
          disabled={busy || empty}
          className="min-h-12 rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
        >
          {busy ? "Saving…" : "Sign"}
        </button>
      </div>
    </div>
  );
}

export function ConfirmTraining({ recordId, userId }: { recordId: string; userId: string }) {
  const [busy, setBusy] = useState(false);
  const [showPad, setShowPad] = useState(false);
  const [result, setResult] = useState<ConfirmResult | null>(null);

  async function confirm(signature: Blob | null) {
    setBusy(true);
    setResult(null);
    const supabase = createClient();
    let path: string | null = null;
    if (signature) {
      path = `${userId}/${newFileId()}.png`;
      const { error } = await supabase.storage
        .from("signatures")
        .upload(path, signature, { contentType: "image/png", upsert: false });
      if (error) {
        setBusy(false);
        return setResult({ ok: false, message: `Could not save the signature: ${error.message}` });
      }
    }
    let saved: ConfirmResult;
    try {
      saved = await confirmTraining(recordId, path);
    } catch {
      saved = { ok: false, message: "Could not reach the server. Check your connection and try again." };
    }
    if (!saved.ok && path) await supabase.storage.from("signatures").remove([path]);
    setBusy(false);
    setResult(saved);
  }

  return (
    <div className="mt-3">
      {!showPad && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setShowPad(true)}
            disabled={busy}
            className="min-h-12 rounded-xl border border-primary/40 bg-primary-light px-3 font-semibold text-primary-dark hover:border-primary disabled:opacity-60"
          >
            Add signature
          </button>
          <button
            type="button"
            onClick={() => confirm(null)}
            disabled={busy}
            className="min-h-12 rounded-xl bg-primary px-3 font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70"
          >
            {busy ? "Saving…" : "Confirm"}
          </button>
        </div>
      )}
      {showPad && <SignaturePad onSign={(png) => confirm(png)} busy={busy} />}
      {result && !result.ok && (
        <p role="alert" className="mt-2 text-sm font-medium text-warning">
          {result.message}
        </p>
      )}
    </div>
  );
}
