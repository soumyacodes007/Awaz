// The hero's saffron/lavender field, shared by the landing hero and the auth
// panel. One continuous field instead of blurred blobs: a saffron bowl
// anchored above the top edge, a lavender wash beneath it, white under the
// nav, and paper toward the bottom. Layers are listed front to back.
export const HERO_GLOW = [
  "linear-gradient(180deg,#fff 0px,rgba(255,255,255,0.75) 40px,rgba(255,255,255,0) 120px)",
  "radial-gradient(ellipse 76% 66% at 50% -12%,#f46a06 0%,#f6720c 54%,rgba(248,128,40,0.88) 68%,rgba(252,170,110,0.45) 84%,rgba(255,200,160,0) 100%)",
  "radial-gradient(ellipse 85% 48% at 50% 46%,rgba(152,172,255,0.85) 0%,rgba(172,188,255,0.6) 45%,rgba(200,210,255,0.25) 75%,rgba(220,226,255,0) 100%)",
  "linear-gradient(180deg,rgba(253,252,252,0) 55%,var(--color-paper) 88%)",
].join(",");
