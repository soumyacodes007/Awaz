import { Reveal } from "./primitives";

// Sarvam's "The AI Platform India Builds On" frame (1140px wide, 6px padding,
// 24px radius) holding a single YouTube video. Until YOUTUBE_ID is set the
// screen stays black.
const YOUTUBE_ID = "";

export function PlatformShowcase() {
  return (
    <section id="product" className="relative isolate px-4 pt-24 pb-28 sm:px-6">
      {/* lavender washing in from the sides, behind the frame */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 30% 45% at 0% 55%,rgba(150,170,255,0.75),rgba(150,170,255,0) 100%),radial-gradient(ellipse 30% 45% at 100% 55%,rgba(150,170,255,0.75),rgba(150,170,255,0) 100%)",
        }}
      />

      <h2 className="mx-auto max-w-[1140px] text-center font-display text-[30px] leading-[1.2] font-[525] tracking-[-0.02em] text-[#1f1f1f] sm:text-4xl">
        The voice platform
        <br />
        India builds on
      </h2>

      <Reveal
        delay={0.1}
        className="mx-auto mt-10 max-w-[1140px] rounded-[24px] border-[0.8px] border-white/20 bg-[linear-gradient(180deg,rgba(0,0,0,0.15),rgba(0,0,0,0.05))] p-1.5"
      >
        <div className="aspect-video overflow-hidden rounded-[18px] bg-black">
          {YOUTUBE_ID ? (
            <iframe
              className="size-full"
              src={`https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}?rel=0`}
              title="Awaz product video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : null}
        </div>
      </Reveal>
    </section>
  );
}
