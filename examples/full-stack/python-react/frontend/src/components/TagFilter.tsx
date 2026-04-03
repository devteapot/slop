import { useSlop } from "@slop-ai/react";
import { slop } from "../slop";

interface Props {
  activeTag: string | null;
  availableTags: string[];
  onTagChange: (tag: string | null) => void;
}

export default function TagFilter({ activeTag, availableTags, onTagChange }: Props) {
  useSlop(slop, "filter", () => ({
    type: "status",
    props: { active_tag: activeTag, available_tags: availableTags },
    actions: {
      set_tag: {
        params: { tag: "string" },
        handler: ({ tag }) => onTagChange(tag as string),
      },
      clear: () => onTagChange(null),
    },
  }));

  if (availableTags.length === 0) return null;

  return (
    <div className="tag-filter">
      <button
        className={`tag-chip ${activeTag === null ? "active" : ""}`}
        onClick={() => onTagChange(null)}
      >
        All
      </button>
      {availableTags.map((tag) => (
        <button
          key={tag}
          className={`tag-chip ${activeTag === tag ? "active" : ""}`}
          onClick={() => onTagChange(activeTag === tag ? null : tag)}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}
