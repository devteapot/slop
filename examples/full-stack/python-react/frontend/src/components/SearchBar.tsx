import { useSlop } from "@slop-ai/react";
import { slop } from "../slop";

interface Props {
  query: string;
  resultCount: number;
  onQueryChange: (query: string) => void;
}

export default function SearchBar({ query, resultCount, onQueryChange }: Props) {
  useSlop(slop, "search", {
    type: "status",
    props: { query, result_count: resultCount },
    actions: {
      set_query: {
        params: { query: "string" },
        handler: ({ query: q }) => onQueryChange(q as string),
      },
      clear: () => onQueryChange(""),
    },
  });

  return (
    <div className="search-bar">
      <input
        type="text"
        placeholder="Search contacts..."
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {query && (
        <button className="search-clear" onClick={() => onQueryChange("")}>
          &times;
        </button>
      )}
    </div>
  );
}
