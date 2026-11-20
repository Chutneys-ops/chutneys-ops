// THE APP ICON, in one place. Every icon (home screen, install, browser tab,
// Apple touch icon) is rendered from this by app/icons/[file]/route.tsx.
//
// It's a placeholder: the green "C" square from the concept demo. When the
// owners send the real logo, change only this file. For example, put the
// logo in public/brand/ and return an <img src={...}> here instead of the
// letter, then rebuild.
//
// The JSX is rendered by next/og (Satori), which supports a subset of CSS:
// inline styles with flexbox. No Tailwind classes here.

export const BRAND_GREEN = "#1F6B47"; // --color-primary in globals.css
export const BRAND_CREAM = "#FBF8F2"; // --color-cream

export type IconVariant = "any" | "maskable" | "apple";

/**
 * The icon artwork at `size` pixels.
 *   any:      rounded square on a transparent background (tabs, desktop)
 *   maskable: full-bleed green, logo inside the middle 80% "safe zone",
 *             because Android crops it to a circle or squircle
 *   apple:    full-bleed square (iOS rounds the corners itself)
 */
export function AppIconArt({ size, variant }: { size: number; variant: IconVariant }) {
  const fullBleed = variant !== "any";
  // The letter is smaller on maskable icons so it survives the crop.
  const letter = Math.round(size * (variant === "maskable" ? 0.46 : 0.62));
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BRAND_GREEN,
        borderRadius: fullBleed ? 0 : Math.round(size * 0.22),
        color: "#ffffff",
        fontSize: letter,
        fontWeight: 700,
        // Nudge up slightly: the font's line box sits a bit low.
        paddingBottom: Math.round(size * 0.04),
      }}
    >
      C
    </div>
  );
}
