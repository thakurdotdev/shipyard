/**
 * Fixed film-grain overlay for the whole site.
 *
 * Deliberately rendered as an inline data-URI SVG turbulence rather than an
 * image file, at 3.5% opacity with `mix-blend-overlay` — it should be felt,
 * not seen. Mounted once in the root layout.
 */
export function Grain() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[60] opacity-[0.035] mix-blend-overlay"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
      }}
    />
  );
}
