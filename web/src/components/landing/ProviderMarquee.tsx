// Text wordmarks rather than logo files: no brand assets to license, and the
// row still reads as "plugs into the stack you already use".
const providers = [
  "Sarvam",
  "ElevenLabs",
  "Deepgram",
  "Cartesia",
  "OpenAI",
  "Gemini",
  "OpenRouter",
  "Twilio",
  "Vobiz",
  "Exotel",
  "Plivo",
  "Telnyx",
];

export function ProviderMarquee() {
  return (
    // Hovering pauses the scroll and lifts the hovered name to full ink.
    <div className="group relative w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
      <ul className="flex w-max animate-marquee items-center gap-14 pr-14 group-hover:[animation-play-state:paused]">
        {[...providers, ...providers].map((name, i) => (
          <li
            key={i}
            aria-hidden={i >= providers.length}
            className="font-display text-xl font-medium tracking-tight text-ink/45 transition-colors duration-300 hover:text-ink sm:text-2xl"
          >
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}
