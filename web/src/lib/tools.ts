import { Calculator, Globe, PhoneForwarded, PhoneOff, Plug, type LucideIcon } from "lucide-react";

/** Tool kinds Awaz can create, keyed by Dograh's tool category. */
export const TOOL_KINDS = {
  end_call: {
    label: "End call",
    icon: PhoneOff,
    color: "#18181b",
    blurb: "Hang up when the conversation is done, with an optional goodbye.",
  },
  transfer_call: {
    label: "Transfer",
    icon: PhoneForwarded,
    color: "#18181b",
    blurb: "Hand the caller to a person or another number.",
  },
  http_api: {
    label: "API request",
    icon: Globe,
    color: "#18181b",
    blurb: "Call your backend mid-call to look up or save data.",
  },
  mcp: {
    label: "MCP server",
    icon: Plug,
    color: "#18181b",
    blurb: "Expose tools from a Model Context Protocol server.",
  },
  calculator: {
    label: "Calculator",
    icon: Calculator,
    color: "#18181b",
    blurb: "Exact arithmetic for quotes, EMIs and totals.",
  },
} satisfies Record<string, { label: string; icon: LucideIcon; color: string; blurb: string }>;

export type ToolKind = keyof typeof TOOL_KINDS;

/** What the tool form edits: Dograh's tool fields plus the type-specific config. */
export type ToolInit = { uuid: string | null; kind: ToolKind; name: string; description: string; config: Record<string, unknown> };

const DEFAULT_CONFIG: Record<ToolKind, Record<string, unknown>> = {
  end_call: { messageType: "none", endCallReason: true },
  transfer_call: { destination_source: "static", destination: "", messageType: "custom", customMessage: "Please hold while I connect you.", timeout: 30 },
  http_api: { method: "POST", url: "", headers: {}, parameters: [], timeout_ms: 5000, customMessage: "" },
  mcp: { transport: "streamable_http", url: "", tools_filter: [], timeout_secs: 30 },
  calculator: {},
};

const DEFAULT_TEXT: Record<ToolKind, { name: string; description: string }> = {
  end_call: { name: "End call", description: "Hang up once the conversation is complete or the caller says goodbye." },
  transfer_call: { name: "Transfer to a person", description: "Transfer the caller to a human when they ask for one or you can't help." },
  http_api: { name: "", description: "" },
  mcp: { name: "", description: "" },
  calculator: { name: "Calculator", description: "Do exact arithmetic for totals, EMIs and quotes." },
};

export const blankTool = (kind: ToolKind): ToolInit => ({ uuid: null, kind, ...DEFAULT_TEXT[kind], config: DEFAULT_CONFIG[kind] });
