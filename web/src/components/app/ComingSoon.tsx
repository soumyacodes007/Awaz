import type { LucideIcon } from "lucide-react";

import { PageHeader } from "./PageHeader";

/** Placeholder for a planned section: what it is and what it will do. */
export function ComingSoon({
  title,
  sub,
  icon: Icon,
  points,
}: {
  title: string;
  sub: string;
  icon: LucideIcon;
  points: string[];
}) {
  return (
    <>
      <PageHeader title={title} sub={sub} />
      <div className="px-6 py-14 sm:px-8">
        <div className="mx-auto max-w-[520px] rounded-lg bg-white p-8 border">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-md bg-muted">
              <Icon className="size-5 text-foreground" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-[15px] font-medium text-foreground">Coming soon</p>
              <p className="text-[13px] text-muted-foreground">Planned for an upcoming release</p>
            </div>
          </div>
          <ul className="mt-6 space-y-2.5">
            {points.map((p) => (
              <li key={p} className="flex gap-2.5 text-[14px] leading-relaxed text-foreground/80">
                <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
