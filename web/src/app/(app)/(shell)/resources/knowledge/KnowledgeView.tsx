"use client";

import { FileText, LibraryBig, LoaderCircle, Search, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  deleteDocumentApiV1KnowledgeBaseDocumentsDocumentUuidDelete,
  getUploadUrlApiV1KnowledgeBaseUploadUrlPost,
  processDocumentApiV1KnowledgeBaseProcessDocumentPost,
  searchChunksApiV1KnowledgeBaseSearchPost,
  type ChunkResponseSchema,
  type DocumentResponseSchema,
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

function SearchBox({ hasDocs }: { hasDocs: boolean }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ChunkResponseSchema[] | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    const res = await searchChunksApiV1KnowledgeBaseSearchPost({ body: { query: q, limit: 4 } }).catch(() => null);
    setBusy(false);
    setResults(res?.data?.chunks ?? []);
  }

  return (
    <Card>
      <CardHeader title="Try a question" sub="See which passages an agent would find for a caller's question." />
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
      {results ? (
        <div className="space-y-2 px-5 pb-5">
          {results.length ? (
            results.map((c) => (
              <div key={c.id} className="rounded-md bg-muted p-3.5">
                <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                  <span>{c.filename}</span>
                  <span className="tabular-nums">{Math.round(c.similarity * 100)}% match</span>
                </div>
                <p className="mt-1.5 line-clamp-4 text-[13.5px] leading-relaxed text-foreground/80">{c.chunk_text}</p>
              </div>
            ))
          ) : (
            <p className="text-[13px] text-muted-foreground">Nothing relevant found.</p>
          )}
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

  async function remove(d: DocumentResponseSchema) {
    if (!window.confirm(`Delete "${d.filename}"? Agents using it lose access.`)) return;
    await deleteDocumentApiV1KnowledgeBaseDocumentsDocumentUuidDelete({ path: { document_uuid: d.document_uuid } }).catch(() => null);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Knowledge base"
        sub="Documents your agents can search mid-call: FAQs, price lists, policies. Attach them to agents from the agent's Tools tab."
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
        <Card>
          {documents.length ? (
            <Table
              head={
                <tr>
                  <th className={th}>Document</th>
                  <th className={th}>Status</th>
                  <th className={`${th} hidden sm:table-cell`}>Passages</th>
                  <th className={`${th} hidden md:table-cell`}>Added</th>
                  <th className={`${th} w-10`} />
                </tr>
              }
            >
              {documents.map((d) => {
                const s = STATUS[d.processing_status] ?? { tone: "blue" as const, label: d.processing_status };
                return (
                  <tr key={d.document_uuid} className={tr}>
                    <td className={td}>
                      <span className="flex items-center gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <FileText className="size-4 text-foreground" strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-foreground">{d.filename}</span>
                          <span className="text-[12px] text-muted-foreground">{bytes(d.file_size_bytes)}</span>
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
                    <td className={td}>
                      <button type="button" onClick={() => remove(d)} aria-label={`Delete ${d.filename}`} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground/70 hover:bg-accent hover:text-red-600">
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
              body="Upload PDFs, Word files, spreadsheets or text. They're split into passages and indexed so agents can look up answers."
            />
          )}
        </Card>
        <SearchBox hasDocs={documents.some((d) => d.processing_status === "completed")} />
      </PageBody>
    </>
  );
}
