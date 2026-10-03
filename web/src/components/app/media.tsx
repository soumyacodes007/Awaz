"use client";

import { Download, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { getSignedUrlApiV1S3SignedUrlGet } from "@/client";

/** Turn a stored recording key into a playable URL (signed, short-lived). */
export function useSignedUrl(key: string | null | undefined, publicUrl?: string | null, inline = true) {
  const [url, setUrl] = useState<string | null>(publicUrl ?? null);
  const [loading, setLoading] = useState(Boolean(key && !publicUrl));
  useEffect(() => {
    if (publicUrl || !key) return;
    let cancelled = false;
    setLoading(true);
    getSignedUrlApiV1S3SignedUrlGet({ query: { key, inline } })
      .then((r) => !cancelled && setUrl(r.data?.url ?? null))
      .catch(() => null)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [key, publicUrl, inline]);
  return { url, loading };
}

export function RecordingPlayer({ storageKey, publicUrl, label }: { storageKey: string | null; publicUrl?: string | null; label?: string }) {
  const { url, loading } = useSignedUrl(storageKey, publicUrl);
  if (!storageKey && !publicUrl) return null;
  return (
    <div className="flex items-center gap-3">
      {loading ? (
        <span className="flex h-10 flex-1 items-center gap-2 rounded-full bg-muted px-4 text-[13px] text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Loading recording…
        </span>
      ) : url ? (
        <>
          <audio controls preload="metadata" src={url} aria-label={label ?? "Call recording"} className="h-10 min-w-0 flex-1" />
          <a href={url} download aria-label="Download recording" className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground border hover:text-foreground">
            <Download className="size-4" />
          </a>
        </>
      ) : (
        <span className="text-[13px] text-muted-foreground">Recording unavailable.</span>
      )}
    </div>
  );
}
