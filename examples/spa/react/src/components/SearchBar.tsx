interface Props {
  query: string;
  onQueryChange: (query: string) => void;
}

export default function SearchBar({ query, onQueryChange }: Props) {
  return (
    <div className="search-bar">
      <input
        type="text"
        placeholder="Search cards..."
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
