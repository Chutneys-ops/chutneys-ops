"use client";

// "Take photo" / "Choose file" for an invoice or certificate, with a preview.
//
// Two inputs because Android hides the file picker when `capture` is set:
//   "Take photo":  accept="image/*" capture="environment" (opens the camera)
//   "Choose file": accept="image/*,application/pdf", no capture
// Photos are shrunk right away (shrink-image.ts), so the preview shows what
// will actually upload. PDFs are checked for size and kept as they are.

import { useEffect, useState, type ChangeEvent } from "react";
import { checkUploadFile, isPdf } from "@/lib/uploads";
import { PdfIcon } from "./pdf-icon";
import { shrinkImage } from "./shrink-image";

export type PickedFile = { blob: Blob; name: string; previewUrl: string | null };

const fileButtonClass =
  "flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary-light px-3 font-semibold text-primary-dark hover:border-primary focus-within:ring-2 focus-within:ring-primary/30 has-disabled:cursor-wait has-disabled:opacity-70";

function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function DocumentPicker({
  legend,
  value,
  onChange,
  onPreparingChange,
  disabled = false,
}: {
  legend: string;
  value: PickedFile | null;
  onChange: (file: PickedFile | null) => void;
  /** True while a photo is being shrunk, so the form can wait. */
  onPreparingChange?: (preparing: boolean) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  // Free the preview image's memory when it changes or the picker goes away.
  const previewUrl = value?.previewUrl;
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function setBusy(busy: boolean) {
    setPreparing(busy);
    onPreparingChange?.(busy);
  }

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clear the input so picking the same file again still fires onChange.
    event.target.value = "";
    if (!file) return;
    setError(null);

    if (isPdf(file.type)) {
      const problem = checkUploadFile(file);
      if (problem) return setError(problem);
      onChange({ blob: file, name: file.name, previewUrl: null });
      return;
    }
    if (!file.type.startsWith("image/")) return setError("Use a photo or a PDF.");

    setBusy(true);
    try {
      const small = await shrinkImage(file);
      const problem = checkUploadFile(small);
      if (problem) return setError(problem);
      onChange({ blob: small, name: file.name, previewUrl: URL.createObjectURL(small) });
    } catch {
      setError("Couldn't read that photo. Take it with the camera, or choose a JPEG or PDF.");
    } finally {
      setBusy(false);
    }
  }

  const off = disabled || preparing;
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-ink">{legend}</legend>
      <div className="mt-1.5 flex gap-2">
        <label className={fileButtonClass}>
          <input type="file" accept="image/*" capture="environment" onChange={pick} disabled={off} className="sr-only" />
          {preparing ? "Preparing…" : "Take photo"}
        </label>
        <label className={fileButtonClass}>
          <input type="file" accept="image/*,application/pdf" onChange={pick} disabled={off} className="sr-only" />
          Choose file
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-sm text-warning">
          {error}
        </p>
      )}
      {value && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-white p-2.5">
          {value.previewUrl ? (
            // A blob: URL for a local preview; next/image can't optimise those.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value.previewUrl}
              alt="Preview"
              className="h-20 w-16 shrink-0 rounded-lg border border-line object-cover"
            />
          ) : (
            <PdfIcon />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{value.name}</p>
            <p className="text-sm text-muted">
              {isPdf(value.blob.type) ? "PDF" : "Photo, shrunk"} · {sizeText(value.blob.size)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="min-h-12 shrink-0 rounded-xl px-3 text-sm font-semibold text-primary hover:text-primary-dark"
          >
            Remove
          </button>
        </div>
      )}
    </fieldset>
  );
}
