"use client";

import { FileText, Globe, LibraryBig, Link2, LoaderCircle, RotateCw, Search, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  addLinkApiV1KnowledgeBaseDocumentsFromUrlPost,
  deleteDocumentApiV1KnowledgeBaseDocumentsDocumentUuidDelete,
  getUploadUrlApiV1KnowledgeBaseUploadUrlPost,
  processDocumentApiV1KnowledgeBaseProcessDocumentPost,
  reprocessApiV1KnowledgeBaseDocumentsDocumentUuidReprocessPost,
  tryQuestionApiV1KnowledgeBaseTryPost,
  type DocumentResponseSchema,
  type TryResponse,
} from "@/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { Badge, btn, Card, CardHeader, EmptyState, ErrorNote, inputCls, Table, td, th, tr } from "@/components/app/ui";
import { apiError } from "@/lib/errors";
import { ago, bytes } from "@/lib/format";

const ACCEPT = ".pdf,.docx,.doc,.txt,.md,.csv,.html,.pptx,.xlsx";

const STATUS: Record<string, { tone: "green" | "amber" | "red" | "blue"; label: string }> = {
  completed: { tone: "green", label: "Ready" },
  processing: { tone: "blue", label: "Processing" },
  pending: { tone: "amber", label: "Queued" },
  failed: { tone: "red", label: "Failed" },
};

const iconBtn =
  "inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground/70 hover:bg-accent disabled:opacity-40";

function SearchBox({ hasDocs }: { hasDocs: boolean }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TryResponse | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    const res = await tryQuestionApiV1KnowledgeBaseTryPost({ body: { query: q } }).catch(() => null);
    setBusy(false);
    setResult(res?.data ?? { hits: [], ms: 0, reranked: false, skipped: true });
  }

  return (
    <Card>
      <CardHeader
        title="Try a question"
        sub="Runs the same search a call does: keyword and meaning matches, re-ranked, best four kept."
      />
      <form onSubmit={run} className="flex gap-2 p-5 pb-4">
        <label className="relative flex-1">
          <span className="sr-only">Question</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={!hasDocs}
            placeholder="What are your clinic timings on Sunday?"
            className={`${inputCls} h-10 pl-9`}
          />
        </label>
        <button type="submit" disabled={busy || !hasDocs || !q.trim()} className={btn("secondary")}>
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : null} Search
        </button>
      </form>
      {result ? (
        <div className="space-y-2 px-5 pb-5">
          <p className="text-[12px] text-muted-foreground tabular-nums">
            {result.skipped
              ? "Nothing relevant: a call would answer this without documents"
              : `${result.hits.length} passages`}{" "}
            · {Math.round(result.ms)} ms
          </p>
          {result.hits.map((h, i) => (
            <div key={i} className="rounded-md bg-muted p-3.5">
              <div className="flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
                <span className="truncate">{h.document}</span>
                <span className="shrink-0 tabular-nums">score {h.score.toFixed(1)}</span>
              </div>
              <p className="mt-1.5 line-clamp-4 text-[13.5px] leading-relaxed whitespace-pre-line text-foreground/80">
                {h.text}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export function KnowledgeView({ documents }: { documents: DocumentResponseSchema[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [adding, setAdding] = useState(false);
  const processing = documents.some((d) => d.processing_status === "processing" || d.processing_status === "pending");

  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [processing, router]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    for (const file of Array.from(files)) {
      setUploading(file.name);
      const mime = file.type || "application/octet-stream";
      const url = await getUploadUrlApiV1KnowledgeBaseUploadUrlPost({ body: { filename: file.name, mime_type: mime } }).catch(() => null);
      if (!url?.data) {
        setError(apiError(url?.error, `Couldn't upload ${file.name}.`));
        break;
      }
      const put = await fetch(url.data.upload_url, { method: "PUT", body: file, headers: { "content-type": mime } }).catch(() => null);
      if (!put?.ok) {
        setError(`Upload of ${file.name} failed. Check that file storage is reachable.`);
        break;
      }
      const proc = await processDocumentApiV1KnowledgeBaseProcessDocumentPost({
        body: { document_uuid: url.data.document_uuid, s3_key: url.data.s3_key },
      }).catch(() => null);
      if (!proc || proc.error) {
        setError(apiError(proc?.error, `Couldn't process ${file.name}.`));
        break;
      }
    }
    setUploading(null);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    if (!link.trim()) return;
    setError(null);
    setAdding(true);
    const res = await addLinkApiV1KnowledgeBaseDocumentsFromUrlPost({ body: { url: link.trim() } }).catch(() => null);
    setAdding(false);
    if (!res?.data) {
      setError(apiError(res?.error, "Couldn't add that link."));
      return;
    }
    setLink("");
    router.refresh();
  }

  async function reprocess(d: DocumentResponseSchema) {
    setError(null);
    const res = await reprocessApiV1KnowledgeBaseDocumentsDocumentUuidReprocessPost({
      path: { document_uuid: d.document_uuid },
    }).catch(() => null);
    if (!res?.data) setError(apiError(res?.error, `Couldn't re-index ${d.filename}.`));
    router.refresh();
  }

  async function remove(d: DocumentResponseSchema) {
    if (!window.confirm(`Delete "${d.filename}"? Agents using it lose access.`)) return;
    await deleteDocumentApiV1KnowledgeBaseDocumentsDocumentUuidDelete({ path: { document_uuid: d.document_uuid } }).catch(() => null);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Knowledge base"
        sub="FAQs, price lists, policies and web pages. Small sets go straight into the agent's prompt; bigger ones are searched every turn. Attach them from the agent's Tools tab."
        actions={
          <>
            <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => upload(e.target.files)} />
            <button type="button" onClick={() => input.current?.click()} disabled={uploading !== null} className={btn("primary")}>
              {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {uploading ? `Uploading ${uploading.slice(0, 18)}…` : "Upload documents"}
            </button>
          </>
        }
      />
      <PageBody>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <form onSubmit={addLink} className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Web page link</span>
            <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              type="url"
              placeholder="Add a web page: https://example.com/pricing"
              className={`${inputCls} h-10 pl-9`}
            />
          </label>
          <button type="submit" disabled={adding || !link.trim()} className={btn("secondary")}>
            {adding ? <LoaderCircle className="size-4 animate-spin" /> : null} Add link
          </button>
        </form>
        <Card>
          {documents.length ? (
            <Table
              head={
                <tr>
                  <th className={th}>Document</th>
                  <th className={th}>Status</th>
                  <th className={`${th} hidden sm:table-cell`}>Passages</th>
                  <th className={`${th} hidden md:table-cell`}>Added</th>
                  <th className={`${th} w-20`} />
                </tr>
              }
            >
              {documents.map((d) => {
                const s = STATUS[d.processing_status] ?? { tone: "blue" as const, label: d.processing_status };
                const Icon = d.source_url ? Globe : FileText;
                const busy = d.processing_status === "processing" || d.processing_status === "pending";
                return (
                  <tr key={d.document_uuid} className={tr}>
                    <td className={td}>
                      <span className="flex items-center gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <Icon className="size-4 text-foreground" strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-foreground">{d.filename}</span>
                          <span className="block max-w-[320px] truncate text-[12px] text-muted-foreground">
                            {d.source_url ?? bytes(d.file_size_bytes)}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className={td}>
                      <Badge tone={s.tone}>
                        {d.processing_status === "processing" ? <LoaderCircle className="size-3 animate-spin" /> : null}
                        {s.label}
                      </Badge>
                      {d.processing_error ? <p className="mt-1 max-w-[260px] text-[12px] text-red-600">{d.processing_error}</p> : null}
                    </td>
                    <td className={`${td} hidden text-muted-foreground sm:table-cell`}>{d.total_chunks || "–"}</td>
                    <td className={`${td} hidden text-muted-foreground md:table-cell`}>{ago(d.created_at)}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      <button
                        type="button"
                        onClick={() => reprocess(d)}
                        disabled={busy}
                        aria-label={`Re-index ${d.filename}`}
                        title={d.source_url ? "Fetch the page again and re-index" : "Re-index"}
                        className={`${iconBtn} hover:text-foreground`}
                      >
                        <RotateCw className="size-4" />
                      </button>
                      <button type="button" onClick={() => remove(d)} aria-label={`Delete ${d.filename}`} className={`${iconBtn} hover:text-red-600`}>
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <EmptyState
              icon={LibraryBig}
              title="No documents yet"
              body="Upload PDFs, Word files, spreadsheets or text, or add a web page by link. They're split into passages and indexed locally."
            />
          )}
        </Card>
        <SearchBox hasDocs={documents.some((d) => d.processing_status === "completed")} />
      </PageBody>
    </>
  );
}
