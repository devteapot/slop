import { Show } from "solid-js";

interface Props {
  query: string;
  onQueryChange: (query: string) => void;
}

export default function SearchBar(props: Props) {
  return (
    <div class="search-bar">
      <input
        type="text"
        placeholder="Search cards..."
        value={props.query}
        onInput={(e) => props.onQueryChange(e.currentTarget.value)}
      />
      <Show when={props.query}>
        <button class="search-clear" onClick={() => props.onQueryChange("")}>
          &times;
        </button>
      </Show>
    </div>
  );
}
