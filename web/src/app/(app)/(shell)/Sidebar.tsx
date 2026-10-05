"use client";

import {
  Activity,
  AudioLines,
  BarChart3,
  Blocks,
  Bot,
  ChevronRight,
  ChevronsUpDown,
  CornerDownLeft,
  CreditCard,
  FlaskConical,
  FolderOpen,
  House,
  KeyRound,
  LibraryBig,
  LogOut,
  Megaphone,
  Menu,
  Mic,
  Phone,
  ScrollText,
  Search,
  Settings,
  SquareTerminal,
  UserRound,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { logout } from "@/app/(auth)/actions";

type Item = { href: string; label: string; icon: LucideIcon; badge?: string };
type Group = { label?: string; items: (Item | { label: string; icon: LucideIcon; children: Item[] })[] };

const NAV: Group[] = [
  { items: [{ href: "/dashboard", label: "Home", icon: House }] },
  {
    label: "Build",
    items: [
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/tools", label: "Tools", icon: Wrench },
      { href: "/phone-numbers", label: "Phone numbers", icon: Phone },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      {
        label: "Resources",
        icon: FolderOpen,
        children: [
          { href: "/resources/knowledge", label: "Knowledge base", icon: LibraryBig },
          { href: "/resources/audio", label: "Audio clips", icon: Mic },
        ],
      },
    ],
  },
  {
    label: "Test",
    items: [
      { href: "/tests", label: "Tests", icon: FlaskConical },
      { href: "/simulations", label: "Simulations", icon: SquareTerminal, badge: "Soon" },
    ],
  },
  {
    label: "Observe",
    items: [
      { href: "/logs", label: "Logs", icon: ScrollText },
      { href: "/recordings", label: "Recordings", icon: AudioLines },
      { href: "/metrics", label: "Metrics", icon: BarChart3 },
      { href: "/runs", label: "Agent runs", icon: Activity },
    ],
  },
  {
    label: "Integrations",
    items: [
      { href: "/api-keys", label: "API keys", icon: KeyRound },
      { href: "/integrations", label: "Integrations", icon: Blocks },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/billing", label: "Billing & usage", icon: CreditCard },
      { href: "/settings", label: "Workspace settings", icon: Settings },
      { href: "/profile", label: "Profile", icon: UserRound },
    ],
  },
];

const ALL_ITEMS: Item[] = NAV.flatMap((g) => g.items.flatMap((i) => ("children" in i ? i.children : [i])));

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function NavLink({ item, pathname, nested = false }: { item: Item; pathname: string; nested?: boolean }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`group flex h-8 items-center gap-2 rounded-md text-sm transition-colors ${nested ? "pr-2 pl-8" : "px-2"} ${
        active ? "bg-zinc-200/70 font-medium text-foreground" : "text-foreground/75 hover:bg-zinc-200/50 hover:text-foreground"
      }`}
    >
      <Icon className={`size-4 shrink-0 ${active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`} strokeWidth={1.75} />
      <span className="truncate">{item.label}</span>
      {item.badge ? (
        <span className="ml-auto rounded border bg-background px-1.5 text-[10.5px] leading-4 font-medium text-muted-foreground">{item.badge}</span>
      ) : null}
    </Link>
  );
}

function NavTree({ pathname }: { pathname: string }) {
  const [resourcesOpen, setResourcesOpen] = useState(() => pathname.startsWith("/resources"));

  return (
    <nav aria-label="App" className="space-y-4">
      {NAV.map((group, gi) => (
        <div key={group.label ?? gi}>
          {group.label ? <p className="mb-1 px-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{group.label}</p> : null}
          <div className="space-y-px">
            {group.items.map((item) =>
              "children" in item ? (
                <div key={item.label}>
                  <button
                    type="button"
                    aria-expanded={resourcesOpen}
                    onClick={() => setResourcesOpen((o) => !o)}
                    className="group flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-foreground/75 transition-colors hover:bg-zinc-200/50 hover:text-foreground"
                  >
                    <item.icon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" strokeWidth={1.75} />
                    {item.label}
                    <ChevronRight className={`ml-auto size-3.5 text-muted-foreground transition-transform ${resourcesOpen ? "rotate-90" : ""}`} />
                  </button>
                  {resourcesOpen ? (
                    <div className="mt-px space-y-px">
                      {item.children.map((c) => (
                        <NavLink key={c.href} item={c} pathname={pathname} nested />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ),
            )}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** ⌘K jump-to-page palette. */
function CommandMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => ALL_ITEMS.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase())), [q]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setIndex(0);
    setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  if (!open) return null;
  const go = (i: Item) => {
    onClose();
    router.push(i.href);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[14vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Search" className="w-full max-w-[520px] overflow-hidden rounded-lg border bg-background shadow-lg">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, results.length - 1));
              if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
              if (e.key === "Enter" && results[index]) go(results[index]);
            }}
            placeholder="Go to…"
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">ESC</kbd>
        </div>
        <ul className="max-h-[320px] overflow-y-auto p-1">
          {results.map((r, i) => (
            <li key={r.href}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(r)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${i === index ? "bg-accent text-foreground" : "text-foreground/80"}`}
              >
                <r.icon className="size-4 text-muted-foreground" strokeWidth={1.75} />
                {r.label}
                {i === index ? <CornerDownLeft className="ml-auto size-3.5 text-muted-foreground" /> : null}
              </button>
            </li>
          ))}
          {!results.length ? <li className="px-2 py-6 text-center text-sm text-muted-foreground">No results.</li> : null}
        </ul>
      </div>
    </div>
  );
}

function SidebarBody({ email, minutes, pathname, onSearch }: { email: string; minutes: number | null; pathname: string; onSearch: () => void }) {
  return (
    <>
      <div className="px-2 pt-1">
        <Link href="/dashboard" className="text-[22px] leading-none font-semibold tracking-tight text-foreground">
          Awaz
        </Link>
      </div>

      {/* Workspace + search, like Vapi's org switcher row */}
      <div className="mt-4 space-y-2">
        <Link href="/settings" className="flex h-9 items-center gap-2 rounded-md border bg-background px-2 shadow-xs transition-colors hover:bg-accent">
          <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary text-[11px] font-semibold text-primary-foreground uppercase">
            {email.charAt(0) || "?"}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{email.split("@")[0] || "Workspace"}</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </Link>
        <button
          type="button"
          onClick={onSearch}
          className="flex h-9 w-full items-center gap-2 rounded-md border bg-background px-2 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent"
        >
          <Search className="size-4" />
          Search
          <kbd className="ml-auto rounded border bg-muted px-1.5 font-mono text-[10px]">⌘K</kbd>
        </button>
      </div>

      <div className="-mx-3 mt-4 min-h-0 flex-1 overflow-y-auto px-3 pb-4 [scrollbar-color:rgba(0,0,0,0.12)_transparent] [scrollbar-width:thin]">
        <NavTree pathname={pathname} />
      </div>

      <div className="space-y-2 border-t pt-3">
        <div className="rounded-md border bg-background p-2.5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="rounded border bg-muted px-1.5 text-[11px] leading-5 font-medium text-foreground/80">Self-hosted</span>
            <span className="text-sm text-foreground tabular-nums">
              {minutes == null ? "–" : minutes.toLocaleString("en-IN")} <span className="text-muted-foreground">min</span>
            </span>
          </div>
          <Link href="/billing" className="mt-2 flex h-7 items-center justify-center rounded-md border text-xs font-medium text-foreground transition-colors hover:bg-accent">
            Usage & billing
          </Link>
        </div>
        <div className="flex items-center gap-2 px-1">
          <Link href="/profile" className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground hover:text-foreground" title={email}>
            {email}
          </Link>
          <form action={logout}>
            <button
              type="submit"
              aria-label="Log out"
              title="Log out"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-zinc-200/60 hover:text-foreground"
            >
              <LogOut className="size-3.5" />
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

export function Sidebar({ email, minutes }: { email: string; minutes: number | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <aside className="sticky top-0 hidden h-svh w-[240px] shrink-0 flex-col border-r bg-sidebar px-3 py-4 md:flex">
        <SidebarBody email={email} minutes={minutes} pathname={pathname} onSearch={() => setSearch(true)} />
      </aside>

      {/* Mobile: top bar + drawer */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-sidebar/95 px-4 backdrop-blur md:hidden">
        <Link href="/dashboard" className="text-[20px] font-semibold tracking-tight text-foreground">
          Awaz
        </Link>
        <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation" className="flex size-9 items-center justify-center rounded-md text-foreground/80 hover:bg-accent">
          <Menu className="size-5" />
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[264px] flex-col border-r bg-sidebar px-3 py-4 shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <X className="size-4" />
            </button>
            <SidebarBody email={email} minutes={minutes} pathname={pathname} onSearch={() => setSearch(true)} />
          </aside>
        </div>
      ) : null}
      <CommandMenu open={search} onClose={() => setSearch(false)} />
    </>
  );
}
