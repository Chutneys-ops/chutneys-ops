// The green rounded "C" square from the concept demo.
// Decorative only: the "Chutneys Ops" text next to it is what screen readers read.
export function LogoMark({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12 rounded-xl text-2xl" : "h-9 w-9 rounded-[10px] text-lg";
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center bg-primary font-display font-bold text-white ${box}`}
    >
      C
    </span>
  );
}
