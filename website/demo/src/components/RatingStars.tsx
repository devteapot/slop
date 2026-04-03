export function RatingStars({ rating, size = "sm" }: { rating: number; size?: "sm" | "md" }) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  const cls = size === "sm" ? "text-xs" : "text-sm";

  return (
    <span className={`${cls} text-amber inline-flex gap-px`}>
      {"★".repeat(full)}
      {half && "½"}
      <span className="text-on-surface-variant">{"☆".repeat(empty)}</span>
    </span>
  );
}
