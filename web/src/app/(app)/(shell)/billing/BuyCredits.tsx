"use client";

import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { createMpsCreditPurchaseUrlApiV1OrganizationsUsageMpsCreditsPurchaseUrlPost } from "@/client";
import { btn } from "@/components/app/ui";
import { apiError } from "@/lib/errors";

/** Opens Dograh's hosted checkout for model credits in a new tab. */
export function BuyCredits() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const res = await createMpsCreditPurchaseUrlApiV1OrganizationsUsageMpsCreditsPurchaseUrlPost().catch(() => null);
    setBusy(false);
    const url = res?.data?.checkout_url;
    if (url) window.open(url, "_blank", "noopener");
    else setError(apiError(res?.error, "Checkout isn't available right now."));
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={go} disabled={busy} className={btn("secondary", "sm")}>
        {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowUpRight className="size-3.5" />} Buy credits
      </button>
      {error ? <span className="text-[12px] text-red-600">{error}</span> : null}
    </div>
  );
}
