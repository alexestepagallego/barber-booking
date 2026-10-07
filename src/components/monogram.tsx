/** The "CB" roundel from the shop sign. */
export function Monogram({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: "h-10 w-10 text-sm",
    md: "h-16 w-16 text-xl",
    lg: "h-24 w-24 text-3xl",
  };
  return (
    <span
      aria-hidden="true"
      className={`font-display inline-flex items-center justify-center rounded-full border border-current tracking-tight ${sizes[size]}`}
    >
      CB
    </span>
  );
}
