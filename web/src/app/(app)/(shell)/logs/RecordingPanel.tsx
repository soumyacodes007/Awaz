"use client";

import { Download, LoaderCircle, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { artifactUrlApiV1LogsCallsRunIdArtifactsTrackUrlGet, waveformApiV1LogsCallsRunIdWaveformTrackGet, type CallLogDetail, type WaveformResponse } from "@/client";
import { btn } from "@/components/app/ui";
import { clock } from "@/lib/logs";

export type Player = {
  audio: React.RefObject<HTMLAudioElement | null>;
  time: number;
  setTime: (t: number) => void;
  seek: (s: number) => void;
};

const AGENT = "#f59e0b";
const CALLER = "#0d9488";
const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

/** One lane of peaks as a single SVG path (thousands of bars stay cheap). */
function Lane({ peaks, color, y, h }: { peaks: number[]; color: string; y: number; h: number }) {
  const d = useMemo(() => {
    const mid = y + h / 2;
    return peaks.map((p, i) => `M${i + 0.5} ${(mid - (p * h) / 2).toFixed(1)}V${(mid + Math.max(0.6, (p * h) / 2)).toFixed(1)}`).join("");
  }, [peaks, y, h]);
  return (
    <>
      <line x1={0} x2={peaks.length} y1={y + h / 2} y2={y + h / 2} stroke={color} strokeOpacity={0.35} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      <path d={d} stroke={color} strokeWidth={0.75} />
    </>
  );
}

export function RecordingPanel({ runId, detail, player }: { runId: number; detail: CallLogDetail; player: Player }) {
  const recorded = Boolean(detail.availability.recording);
  const [waves, setWaves] = useState<{ bot?: WaveformResponse; user?: WaveformResponse; mixed?: WaveformResponse } | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [duration, setDuration] = useState<number>(detail.call.duration_seconds ?? 0);
  const retried = useRef(false);
  const svg = useRef<SVGSVGElement>(null);

  const fetchUrl = () =>
    artifactUrlApiV1LogsCallsRunIdArtifactsTrackUrlGet({ path: { run_id: runId, track: "mixed" } })
      .then((r) => (r.data ? setSrc(r.data.url) : setLoadError("Recording isn't available.")))
      .catch(() => setLoadError("Couldn't load the recording."));

  useEffect(() => {
    if (!recorded) return;
    fetchUrl();
    const get = (track: "bot" | "user" | "mixed") =>
      waveformApiV1LogsCallsRunIdWaveformTrackGet({ path: { run_id: runId, track } })
        .then((r) => r.data)
        .catch(() => undefined);
    Promise.all([get("bot"), get("user")]).then(async ([bot, user]) => {
      if (bot?.available || user?.available) return setWaves({ bot, user });
      setWaves({ mixed: await get("mixed") });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, recorded]);

  useEffect(() => {
    const a = player.audio.current;
    if (a) a.playbackRate = speed;
  }, [speed, player.audio, src]);

  if (!recorded) {
    return (
      <div className="border-b px-5 py-4">
        <p className="text-sm font-semibold text-foreground">Recording</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {detail.call.channel === "chat" ? "Text chat. There's no audio for this conversation." : "No recording was saved for this call."}
        </p>
      </div>
    );
  }

  const lanes = waves?.bot?.available || waves?.user?.available ? ([["bot", AGENT], ["user", CALLER]] as const) : ([["mixed", CALLER]] as const);
  const total = duration || waves?.bot?.duration_seconds || waves?.user?.duration_seconds || waves?.mixed?.duration_seconds || 0;
  const width = Math.max(...lanes.map(([k]) => waves?.[k]?.peaks.length ?? 0), 1);
  const laneH = 46;
  const height = lanes.length * laneH;
  const progress = total ? Math.min(1, player.time / total) : 0;

  // Tick marks: every second for short calls, sparser for long ones.
  const step = total > 600 ? 30 : total > 180 ? 10 : total > 60 ? 5 : 1;
  const labelEvery = step === 1 ? 5 : step * 3;
  const ticks = total ? Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step) : [];

  const seekAt = (clientX: number) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || !total) return;
    player.seek(Math.max(0, Math.min(total, ((clientX - r.left) / r.width) * total)));
  };

  return (
    <div className="border-b px-5 pt-4 pb-3">
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold text-foreground">Recording</p>
        <span className="font-mono text-sm text-muted-foreground tabular-nums">
          {clock(player.time)} <span className="text-muted-foreground/60">/ {clock(total)}</span>
        </span>
      </div>

      {loadError ? <p className="mt-2 text-[13px] text-destructive">{loadError}</p> : null}

      <div className="relative mt-3 select-none">
        {waves ? (
          <svg
            ref={svg}
            role="slider"
            aria-label="Seek recording"
            aria-valuemin={0}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(player.time)}
            tabIndex={0}
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            onClick={(e) => seekAt(e.clientX)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") player.seek(Math.min(total, player.time + 5));
              if (e.key === "ArrowLeft") player.seek(Math.max(0, player.time - 5));
            }}
            className="block h-[92px] w-full cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {lanes.map(([k, color], i) => (waves[k]?.available ? <Lane key={k} peaks={waves[k]!.peaks} color={color} y={i * laneH + 3} h={laneH - 6} /> : null))}
            <rect x={0} y={0} width={width * progress} height={height} fill="currentColor" className="text-foreground" opacity={0.05} />
            <line x1={width * progress} x2={width * progress} y1={0} y2={height} stroke="currentColor" className="text-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </svg>
        ) : (
          <div className="flex h-[92px] items-center justify-center rounded-md bg-muted/50 text-[13px] text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" /> Loading waveform…
          </div>
        )}
        {/* Timeline */}
        <div className="relative mt-1 h-5 border-t">
          {ticks.map((t) => (
            <span key={t} className="absolute top-0 flex flex-col items-center" style={{ left: `${(t / total) * 100}%`, transform: "translateX(-50%)" }}>
              <span className={`w-px bg-border ${t % labelEvery === 0 ? "h-2" : "h-1"}`} />
              {t % labelEvery === 0 && t > 0 ? <span className="text-[10px] text-muted-foreground tabular-nums">{t >= 60 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}` : t}</span> : null}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          disabled={!src}
          onClick={() => {
            const a = player.audio.current;
            if (!a) return;
            if (a.paused) a.play().catch(() => null);
            else a.pause();
          }}
          className={btn("primary", "md", "size-9 px-0")}
        >
          {playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
        </button>
        <button type="button" onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])} className={btn("secondary", "md", "w-14 px-0 font-mono text-[13px]")}>
          {speed}x
        </button>
        {lanes.length > 1 ? (
          <span className="ml-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: AGENT }} /> Agent
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: CALLER }} /> Caller
            </span>
          </span>
        ) : null}
        <a href={`/api/v1/logs/calls/${runId}/artifacts/mixed`} className={btn("secondary", "md", "ml-auto")}>
          <Download className="size-4" /> Audio
        </a>
      </div>

      {src ? (
        <audio
          ref={player.audio}
          src={src}
          preload="metadata"
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => player.setTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => {
            // Signed URLs live ~5 minutes; fetch a fresh one once.
            if (retried.current) return setLoadError("Couldn't play the recording.");
            retried.current = true;
            fetchUrl();
          }}
          className="hidden"
        />
      ) : null}
    </div>
  );
}
