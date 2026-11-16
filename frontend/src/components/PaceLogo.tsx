/**
 * The Pace wordmark: a motion glyph plus the name.
 *
 * Drawn here rather than shipped as an image, which removes the problem the template
 * had: its logo was a PNG whose dark lettering disappeared on the dark sidebar, so it
 * needed a second recoloured copy and a `dark:hidden` / `dark:block` pair to swap them.
 * This inherits `currentColor` and the app's font, so one definition is correct in both
 * themes and at any size, and there is nothing to re-export when a colour token moves.
 *
 * The glyph is three motion lines running into a chevron — picking up pace. It is built
 * from round-capped strokes on a 24-unit grid so it stays legible when it is small; the
 * favicon (`public/favicon.svg`) is the same chevron, with the lines dropped because
 * they merge at 16px.
 */
export default function PaceLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-6 w-6 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 12h5.5" />
        <path d="M5.75 7.5h2.75" />
        <path d="M5.75 16.5h2.75" />
        <path d="m12 6.5 5.5 5.5-5.5 5.5" />
      </svg>
      <span className="text-[20px] font-semibold leading-none tracking-tight">Pace</span>
    </span>
  );
}
