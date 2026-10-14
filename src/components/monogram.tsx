/**
 * The "BB" roundel of the Barber Booker brand. `introTarget` marks the one
 * the intro curtain lands on (see intro-curtain.tsx).
 */
export function Monogram({
  size = "md",
  introTarget = false,
}: {
  size?: "sm" | "md" | "lg";
  introTarget?: boolean;
}) {
  const sizes = {
    sm: "h-10 w-10 text-sm",
    md: "h-16 w-16 text-xl",
    lg: "h-24 w-24 text-3xl",
  };
  return (
    <span
      aria-hidden="true"
      data-intro-target={introTarget ? "" : undefined}
      className={`font-display inline-flex items-center justify-center rounded-full border border-current tracking-tight ${sizes[size]}`}
    >
      BB
    </span>
  );
}
