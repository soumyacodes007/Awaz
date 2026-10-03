"use client";

import { LoaderCircle, Mic, Pause, Play, Trash2, Upload, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createRecordingsApiV1WorkflowRecordingsPost,
  deleteRecordingApiV1WorkflowRecordingsRecordingIdDelete,
  getSignedUrlApiV1S3SignedUrlGet,
  getUploadUrlsApiV1WorkflowRecordingsUploadUrlPost,
  transcribeAudioApiV1WorkflowRecordingsTranscribePost,
  type RecordingResponseSchema,
} from "@/client";
import { CopyButton, Modal } from "@/components/app/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { btn, Card, EmptyState, ErrorNote, FormRow, inputCls } from "@/components/app/ui";
import { apiError } from "@/lib/errors";
import { ago } from "@/lib/format";

function PlayButton({ clip }: { clip: RecordingResponseSchema }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");

  async function toggle() {
    if (state === "playing") {
      audio.current?.pause();
      return setState("idle");
    }
    if (!audio.current) {
      setState("loading");
      const res = await getSignedUrlApiV1S3SignedUrlGet({ query: { key: clip.storage_key, inline: true, storage_backend: clip.storage_backend } }).catch(() => null);
      if (!res?.data) return setState("idle");
      audio.current = new Audio(res.data.url);
      audio.current.onended = () => setState("idle");
    }
    await audio.current.play().catch(() => null);
    setState("playing");
  }

  return (
    <button type="button" onClick={toggle} aria-label={state === "playing" ? "Pause" : "Play"} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-white transition hover:bg-primary/90">
      {state === "loading" ? <LoaderCircle className="size-4 animate-spin" /> : state === "playing" ? <Pause className="size-3.5" /> : <Play className="ml-0.5 size-3.5" />}
    </button>
  );
}

export function AudioView({ clips }: { clips: RecordingResponseSchema[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState<"transcribe" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function transcribe(f: File) {
    setBusy("transcribe");
    const res = await transcribeAudioApiV1WorkflowRecordingsTranscribePost({ body: { file: f } }).catch(() => null);
    setBusy(null);
    const text = (res?.data as { transcript?: string } | undefined)?.transcript;
    if (text) setTranscript(text);
  }

  function choose(f: File | null) {
    setFile(f);
    setTranscript("");
    setError(null);
    if (f) transcribe(f);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy("save");
    setError(null);
    const mime = file.type || "audio/wav";
    const urls = await getUploadUrlsApiV1WorkflowRecordingsUploadUrlPost({ body: { files: [{ filename: file.name, mime_type: mime, file_size: file.size }] } }).catch(() => null);
    const item = urls?.data?.items[0];
    if (!item) {
      setBusy(null);
      return setError(apiError(urls?.error, "Couldn't prepare the upload."));
    }
    const put = await fetch(item.upload_url, { method: "PUT", body: file, headers: { "content-type": mime } }).catch(() => null);
    if (!put?.ok) {
      setBusy(null);
      return setError("Upload failed. Check that file storage is reachable.");
    }
    const created = await createRecordingsApiV1WorkflowRecordingsPost({
      body: { recordings: [{ recording_id: item.recording_id, storage_key: item.storage_key, transcript: transcript.trim() || file.name }] },
    }).catch(() => null);
    setBusy(null);
    if (!created || created.error) return setError(apiError(created?.error, "Couldn't save the clip."));
    setFile(null);
    router.refresh();
  }

  async function remove(c: RecordingResponseSchema) {
    if (!window.confirm("Delete this clip? Agents and tools using it will fall back to silence.")) return;
    await deleteRecordingApiV1WorkflowRecordingsRecordingIdDelete({ path: { recording_id: c.recording_id } }).catch(() => null);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Audio clips"
        sub="Pre-recorded audio agents can play as a greeting, before a transfer, or when hanging up. Real voices sound warmer than any TTS."
        actions={
          <>
            <input ref={input} type="file" accept="audio/*" className="hidden" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => input.current?.click()} className={btn("primary")}>
              <Upload className="size-4" /> Upload clip
            </button>
          </>
        }
      />
      <PageBody>
        <Card>
          {clips.length ? (
            <ul className="divide-y divide-border">
              {clips.map((c) => (
                <li key={c.id} className="flex items-center gap-4 px-5 py-3.5">
                  <PlayButton clip={c} />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[14px] text-foreground">{c.transcript || "Untitled clip"}</p>
                    <p className="mt-0.5 flex items-center gap-1 font-mono text-[12px] text-muted-foreground">
                      {c.recording_id}
                      <CopyButton value={c.recording_id} label="Copy clip ID" />
                      <span className="font-sans">· {ago(c.created_at)}</span>
                    </p>
                  </div>
                  <button type="button" onClick={() => remove(c)} aria-label="Delete clip" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground/70 hover:bg-accent hover:text-red-600">
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Mic} title="No audio clips yet" body="Upload a WAV or MP3 of a real person saying your greeting. We'll transcribe it so the agent knows what was said." />
          )}
        </Card>
      </PageBody>

      <Modal open={Boolean(file)} onClose={() => busy !== "save" && setFile(null)} title="Add audio clip" sub={file?.name}>
        <form onSubmit={save} className="space-y-4">
          {preview ? <audio controls src={preview} className="w-full" /> : null}
          <FormRow
            label="What's said in the clip"
            htmlFor="clip-t"
            hint={busy === "transcribe" ? "Transcribing…" : "Added to the conversation so the agent knows what the caller heard."}
          >
            <div className="relative">
              <textarea id="clip-t" rows={3} value={transcript} onChange={(e) => setTranscript(e.target.value)} className={`${inputCls} resize-y py-2.5 pr-10`} />
              {busy === "transcribe" ? <Wand2 className="absolute top-3 right-3 size-4 animate-pulse text-foreground" /> : null}
            </div>
          </FormRow>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setFile(null)} className={btn("ghost")}>
              Cancel
            </button>
            <button type="submit" disabled={busy !== null} className={btn("primary")}>
              {busy === "save" ? <LoaderCircle className="size-4 animate-spin" /> : null} Save clip
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
