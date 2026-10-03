"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

const BASE = "http://localhost:8000/api/v1";

export type Endpoint = {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
};

const LANGS = ["Python", "JavaScript", "cURL"] as const;
type Lang = (typeof LANGS)[number];

function indent(text: string, spaces: number) {
  return text.replace(/\n/g, `\n${" ".repeat(spaces)}`);
}

// One endpoint, rendered as an idiomatic request in each language.
function snippet({ method, path, body }: Endpoint, lang: Lang) {
  const url = `${BASE}${path}`;
  const json = body ? JSON.stringify(body, null, 4) : "";
  if (lang === "Python") {
    const py = json.replace(/: true/g, ": True").replace(/: false/g, ": False");
    return `import requests

resp = requests.${method.toLowerCase()}(
    "${url}",
    headers={"X-API-Key": "YOUR_API_KEY"},${body ? `\n    json=${indent(py, 4)},` : ""}
)
print(resp.json())`;
  }
  if (lang === "JavaScript") {
    return `const resp = await fetch("${url}", {
  method: "${method}",
  headers: {${body ? `\n    "Content-Type": "application/json",` : ""}
    "X-API-Key": "YOUR_API_KEY",
  },${body ? `\n  body: JSON.stringify(${indent(JSON.stringify(body, null, 2), 2)}),` : ""}
});
console.log(await resp.json());`;
  }
  return `curl -X ${method} \\
  "${url}" \\${body ? `\n  -H "Content-Type: application/json" \\` : ""}
  -H "X-API-Key: YOUR_API_KEY"${body ? ` \\\n  -d '${indent(JSON.stringify(body, null, 2), 2)}'` : ""}`;
}

const KEYWORDS = new Set(["import", "const", "await", "print", "curl", "method", "headers", "body", "json", "requests"]);

// Minimal highlighter: strings and a few keywords are enough for a teaser.
function highlight(code: string) {
  return code.split(/("(?:[^"\\]|\\.)*"|'[^']*'|\b[a-zA-Z_]+\b)/g).map((part, i) => {
    if (/^["']/.test(part)) return <span key={i} className="text-[#6a8a1f]">{part}</span>;
    if (KEYWORDS.has(part)) return <span key={i} className="text-[#3b4fd1]">{part}</span>;
    return part;
  });
}

export function CodeTabs({ endpoint, animKey }: { endpoint: Endpoint; animKey: string }) {
  const [lang, setLang] = useState<Lang>("Python");
  const [copied, setCopied] = useState(false);
  const code = snippet(endpoint, lang);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context); copying is best-effort.
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[12px] border-[0.8px] border-[#f0f0f0] bg-white">
      <div className="flex items-center border-b border-[#f0f0f0] bg-[#fafafa]">
        <div role="tablist" aria-label="Language" className="flex">
          {LANGS.map((l) => (
            <button
              key={l}
              role="tab"
              aria-selected={l === lang}
              onClick={() => setLang(l)}
              className={`border-t-2 px-4 py-2.5 text-[13px] font-[525] transition-colors ${
                l === lang ? "border-[#556adc] bg-white text-ink" : "border-transparent text-[#666] hover:text-ink"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <button
          onClick={copy}
          className="ml-auto flex items-center gap-1.5 px-4 text-[13px] text-[#666] hover:text-ink"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <pre
          key={`${animKey}-${lang}`}
          className="animate-fade-up overflow-x-auto px-4 py-4 font-mono text-[12px] leading-[21.6px] text-[#1f1f1f]"
        >
          <code>{highlight(code)}</code>
        </pre>
        {/* fade the tail so the overlaid CTA sits on a clean surface */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-white/0 via-[#f6f7ff]/90 to-[#eef0ff]" />
      </div>
    </div>
  );
}
