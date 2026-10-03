import { ChevronLeft } from "lucide-react";
import Link from "next/link";

/** Title row at the top of every app page. */
export function PageHeader({
  title,
  sub,
  actions,
  back,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="border-b px-6 pt-6 pb-5 sm:px-8">
      {back ? (
        <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          <ChevronLeft className="size-3.5" /> {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {sub ? <div className="mt-1 text-sm text-muted-foreground">{sub}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Standard padded body below a PageHeader. */
export function PageBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`space-y-6 px-6 py-6 sm:px-8 ${className}`}>{children}</div>;
}
