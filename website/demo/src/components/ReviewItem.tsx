import type { Review } from "../state";
import { RatingStars } from "./RatingStars";

export function ReviewItem({ review }: { review: Review }) {
  return (
    <div className="py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-on-surface">{review.author}</span>
        <RatingStars rating={review.rating} />
        <span className="text-[10px] text-on-surface-variant font-mono ml-auto">
          {review.date}
        </span>
      </div>
      <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
        {review.text}
      </p>
    </div>
  );
}
