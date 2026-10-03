// Shared bits for the Observe pages (runs, logs, recordings, metrics).

export type RunFilters = {
  agent?: number | null;
  channel?: "telephony" | "web" | "chat" | null;
  direction?: "inbound" | "outbound" | null;
  from?: string | null; // yyyy-mm-dd
  to?: string | null;
};

/** Dograh's JSON filter format for /organizations/usage/runs. */
export function filterParam(f: RunFilters) {
  const out: { attribute: string; type: string; value: Record<string, unknown> }[] = [];
  if (f.agent) out.push({ attribute: "workflowId", type: "number", value: { value: f.agent } });
  if (f.channel) out.push({ attribute: "callChannel", type: "radio", value: { status: f.channel } });
  if (f.direction) out.push({ attribute: "callDirection", type: "radio", value: { status: f.direction } });
  if (f.from || f.to) {
    out.push({
      attribute: "dateRange",
      type: "dateRange",
      value: { from: f.from ? `${f.from}T00:00:00` : undefined, to: f.to ? `${f.to}T23:59:59` : undefined },
    });
  }
  return out.length ? JSON.stringify(out) : undefined;
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): RunFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const channel = one("channel");
  const direction = one("direction");
  return {
    agent: one("agent") ? Number(one("agent")) : null,
    channel: channel === "telephony" || channel === "web" || channel === "chat" ? channel : null,
    direction: direction === "inbound" || direction === "outbound" ? direction : null,
    from: one("from"),
    to: one("to"),
  };
}

const PHONE_MODES = new Set(["twilio", "vobiz", "exotel", "plivo", "telnyx", "vonage", "cloudonix", "ari", "stasis"]);

export function channelOf(mode: string | null | undefined): { label: string; kind: "phone" | "web" | "chat" | "other" } {
  if (!mode) return { label: "–", kind: "other" };
  if (mode === "textchat") return { label: "Text chat", kind: "chat" };
  if (mode.includes("webrtc") || mode === "embed") return { label: "Web call", kind: "web" };
  if (PHONE_MODES.has(mode)) return { label: "Phone", kind: "phone" };
  return { label: mode, kind: "other" };
}
