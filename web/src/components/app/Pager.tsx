import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

/** Previous / next links that keep the current filters. */
export function Pager({
  page,
  totalPages,
  path,
  params,
}: {
  page: number;
  totalPages: number;
  path: string;
  params: Record<string, string | string[] | undefined>;
}) {
  if (totalPages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (typeof v === "string" && k !== "page" && k !== "run") q.set(k, v);
    if (p > 1) q.set("page", String(p));
    return `${path}${q.toString() ? `?${q}` : ""}`;
  };
  const cls = "flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] border transition hover:border-foreground/25";
  return (
    <div className="flex items-center justify-between border-t border-border px-5 py-3 text-[13px] text-muted-foreground">
      <span>
        Page {page} of {totalPages}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={cls}>
            <ChevronLeft className="size-3.5" /> Previous
          </Link>
        ) : null}
        {page < totalPages ? (
          <Link href={href(page + 1)} className={cls}>
            Next <ChevronRight className="size-3.5" />
          </Link>
        ) : null}
      </span>
    </div>
  );
}
