"use client";

import { ArrowUp, LoaderCircle, MessageSquareText, Phone, RotateCcw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  appendTextChatMessageApiV1WorkflowWorkflowIdTextChatSessionsRunIdMessagesPost,
  createTextChatSessionApiV1WorkflowWorkflowIdTextChatSessionsPost,
  endTextChatSessionApiV1WorkflowWorkflowIdTextChatSessionsRunIdEndPost,
  initiateCallApiV1TelephonyInitiateCallPost,
} from "@/client";
import { btn, ErrorNote, FormRow, inputCls } from "@/components/app/ui";
import { apiError } from "@/lib/errors";

type Turn = { id: string; user?: string; agent?: string; pending?: boolean };

type Session = {
  workflow_run_id: number;
  revision: number;
  is_completed: boolean;
  session_data: { turns?: { id: string; user_message?: { text: string } | null; assistant_message?: { text: string } | null }[] };
};

const turnsOf = (s: Session): Turn[] =>
  (s.session_data.turns ?? []).map((t) => ({ id: t.id, user: t.user_message?.text, agent: t.assistant_message?.text }));

function Chat({ agentId, beforeStart }: { agentId: number; beforeStart: () => Promise<void> }) {
  const [session, setSession] = useState<Session | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    setTurns([]);
    await beforeStart();
    const res = await createTextChatSessionApiV1WorkflowWorkflowIdTextChatSessionsPost({
      path: { workflow_id: agentId },
      body: { name: "Awaz test chat" },
    }).catch(() => null);
    setBusy(false);
    if (!res?.data) return setError(apiError(res?.error, "Couldn't start a chat. Check the workspace models in Integrations."));
    const s = res.data as unknown as Session;
    setSession(s);
    setTurns(turnsOf(s));
  }, [agentId, beforeStart]);

  // Start once per mount (dev StrictMode runs effects twice).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start();
  }, [start]);

  // End the session when the panel closes, so the run is marked complete.
  const live = useRef<Session | null>(null);
  live.current = session;
  useEffect(
    () => () => {
      const s = live.current;
      if (s && !s.is_completed) {
        endTextChatSessionApiV1WorkflowWorkflowIdTextChatSessionsRunIdEndPost({
          path: { workflow_id: agentId, run_id: s.workflow_run_id },
          body: {},
        }).catch(() => null);
      }
    },
    [agentId],
  );

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const msg = text.trim();
    if (!msg || !session || busy) return;
    setText("");
    setBusy(true);
    setTurns((t) => [...t, { id: `pending-${Date.now()}`, user: msg, pending: true }]);
    const res = await appendTextChatMessageApiV1WorkflowWorkflowIdTextChatSessionsRunIdMessagesPost({
      path: { workflow_id: agentId, run_id: session.workflow_run_id },
      body: { text: msg, expected_revision: session.revision },
    }).catch(() => null);
    setBusy(false);
    if (!res?.data) {
      setTurns((t) => t.filter((x) => !x.pending));
      return setError(apiError(res?.error, "The agent didn't respond."));
    }
    const s = res.data as unknown as Session;
    setSession(s);
    setTurns(turnsOf(s));
  }

  async function restart() {
    if (session) {
      await endTextChatSessionApiV1WorkflowWorkflowIdTextChatSessionsRunIdEndPost({
        path: { workflow_id: agentId, run_id: session.workflow_run_id },
        body: {},
      }).catch(() => null);
    }
    setSession(null);
    start();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <p className="text-center text-[12px] text-muted-foreground/70">Chatting with the latest draft. Same prompt and tools, no audio.</p>
        {turns.map((t) => (
          <div key={t.id} className="space-y-3">
            {t.user ? (
              <div className="flex justify-end">
                <p className={`max-w-[85%] rounded-lg rounded-br-md bg-primary px-3.5 py-2 text-[14px] leading-relaxed text-white ${t.pending ? "opacity-70" : ""}`}>{t.user}</p>
              </div>
            ) : null}
            {t.agent ? (
              <div className="flex">
                <p className="max-w-[85%] rounded-lg rounded-bl-md bg-muted px-3.5 py-2 text-[14px] leading-relaxed text-foreground">{t.agent}</p>
              </div>
            ) : null}
          </div>
        ))}
        {busy ? (
          <div className="flex">
            <span className="flex gap-1 rounded-lg rounded-bl-md bg-muted px-3.5 py-3">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </span>
          </div>
        ) : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="flex items-center gap-2 border-t border-border p-3">
        <button type="button" onClick={restart} aria-label="Restart chat" title="Restart chat" className={btn("ghost", "sm", "size-9 px-0")}>
          <RotateCcw className="size-4" />
        </button>
        <input
          aria-label="Message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={session ? "Type as the caller…" : "Starting…"}
          disabled={!session}
          className={`${inputCls} h-10 flex-1`}
        />
        <button type="submit" aria-label="Send" disabled={!text.trim() || busy || !session} className={btn("primary", "md", "size-10 px-0")}>
          <ArrowUp className="size-4" />
        </button>
      </form>
    </div>
  );
}

function PhoneTest({
  agentId,
  telephony,
  testPhone,
  beforeStart,
}: {
  agentId: number;
  telephony: { id: number; name: string; ready: boolean }[];
  testPhone: string | null;
  beforeStart: () => Promise<void>;
}) {
  const [phone, setPhone] = useState(testPhone ?? "+91");
  const [config, setConfig] = useState<number | "">(telephony.find((t) => t.ready)?.id ?? telephony[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<number | null>(null);

  async function call(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setRunId(null);
    await beforeStart();
    const res = await initiateCallApiV1TelephonyInitiateCallPost({
      body: { workflow_id: agentId, phone_number: phone.replace(/\s+/g, ""), telephony_configuration_id: config || null },
    }).catch(() => null);
    setBusy(false);
    if (!res || res.error) return setError(apiError(res?.error, "Couldn't place the call."));
    const data = res.data as { workflow_run_id?: number } | undefined;
    setRunId(data?.workflow_run_id ?? null);
  }

  if (!telephony.length) {
    return (
      <div className="px-5 py-8 text-center text-[13.5px] text-muted-foreground">
        Connect a telephony provider first.{" "}
        <Link href="/phone-numbers" className="text-foreground hover:underline">
          Set up phone numbers
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={call} className="space-y-4 px-5 py-5">
      <FormRow label="Call this number" htmlFor="test-phone" hint="Include the country code. The agent calls you using the latest draft.">
        <input id="test-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${inputCls} h-10`} />
      </FormRow>
      <FormRow label="From" htmlFor="test-config">
        <select id="test-config" value={config} onChange={(e) => setConfig(Number(e.target.value))} className={`${inputCls} h-10`}>
          {telephony.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.ready ? "" : " (not ready for outbound)"}
            </option>
          ))}
        </select>
      </FormRow>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {runId ? (
        <p className="rounded-md bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700">
          Calling now.{" "}
          <Link href={`/runs/${agentId}/${runId}`} className="underline">
            Watch call #{runId}
          </Link>
        </p>
      ) : null}
      <button type="submit" disabled={busy || phone.replace(/\D/g, "").length < 8} className={btn("primary", "md", "w-full")}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Phone className="size-4" />}
        Call me
      </button>
    </form>
  );
}

export function TestPanel({
  open,
  mode: initialMode,
  onClose,
  agentId,
  telephony,
  testPhone,
  beforeStart,
}: {
  open: boolean;
  mode: "chat" | "phone";
  onClose: () => void;
  agentId: number;
  telephony: { id: number; name: string; ready: boolean }[];
  testPhone: string | null;
  beforeStart: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"chat" | "phone">(initialMode);
  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          role="dialog"
          aria-label="Test agent"
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[400px] flex-col border-l border-border bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <div className="inline-flex rounded-lg bg-muted p-0.5">
              {[
                { id: "chat" as const, label: "Chat", icon: MessageSquareText },
                { id: "phone" as const, label: "Phone call", icon: Phone },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  aria-pressed={mode === id}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition ${
                    mode === id ? "bg-white text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          {mode === "chat" ? (
            <Chat agentId={agentId} beforeStart={beforeStart} />
          ) : (
            <PhoneTest agentId={agentId} telephony={telephony} testPhone={testPhone} beforeStart={beforeStart} />
          )}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
