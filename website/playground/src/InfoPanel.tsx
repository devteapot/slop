import { highlight } from "./highlight";

const EXAMPLE_CODE = `import { createSlop } from "@slop-ai/client";
import { useSlop } from "@slop-ai/react";

const slop = createSlop({
  id: "my-app",
  name: "My App",
});

function TodoList() {
  const [todos, setTodos] = useState([...]);

  useSlop(slop, "todos", () => ({
    type: "collection",
    props: { count: todos.length },
    items: todos.map(t => ({...})),
  }));
}`;

const HIGHLIGHTED_EXAMPLE = highlight(EXAMPLE_CODE);

interface InfoPanelProps {
  open: boolean;
  onToggle: () => void;
}

export function InfoPanel({ open, onToggle }: InfoPanelProps) {
  if (!open) {
    return (
      <div
        className="flex flex-col items-center h-full bg-surface-container cursor-pointer hover:bg-surface-highest transition-colors"
        style={{ width: 32 }}
        onClick={onToggle}
      >
        <span
          className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant mt-4"
          style={{ writingMode: "vertical-rl" }}
        >
          Guide
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 h-full bg-surface-low overflow-hidden">
      <div
        className="px-3 flex items-center justify-between h-8 bg-surface-container cursor-pointer"
        onClick={onToggle}
      >
        <span className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
          Guide
        </span>
        <span className="text-on-surface-variant/40 text-xs">✕</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm text-on-surface-variant leading-relaxed space-y-4">
        <p>
          Write{" "}
          <code className="font-mono text-primary/70 text-[13px]">register(path, descriptor)</code>{" "}
          calls to build a SLOP state tree. Click actions in the tree to invoke them.
        </p>

        <div>
          <p className="text-on-surface font-medium mb-1.5">Sandbox vs real SDK</p>
          <ul className="list-disc list-inside space-y-1.5 text-[13px]">
            <li>
              <code className="font-mono text-primary/70">register()</code> is a global here
              — in your app it's{" "}
              <code className="font-mono text-primary/70">slop.register()</code>
            </li>
            <li>
              State is plain mutable variables — in React you'd
              use <code className="font-mono text-primary/70">useState</code> +{" "}
              <code className="font-mono text-primary/70">useSlop</code> hook
            </li>
            <li>
              <code className="font-mono text-primary/70">const</code>/<code className="font-mono text-primary/70">let</code> are
              converted to <code className="font-mono text-primary/70">var</code> so
              handler mutations persist
            </li>
          </ul>
        </div>

        <div>
          <p className="text-on-surface font-medium mb-1.5">In a real project</p>
          <pre
            className="font-mono text-[12px] bg-surface-lowest rounded-sm p-3 leading-relaxed whitespace-pre overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: HIGHLIGHTED_EXAMPLE }}
          />
        </div>

        <div>
          <p className="text-on-surface font-medium mb-1.5">What's the same</p>
          <p className="text-[13px]">
            The descriptor format is identical —{" "}
            <code className="font-mono text-primary/70">type</code>,{" "}
            <code className="font-mono text-primary/70">props</code>,{" "}
            <code className="font-mono text-primary/70">items</code>,{" "}
            <code className="font-mono text-primary/70">actions</code>,{" "}
            <code className="font-mono text-primary/70">children</code>{" "}
            work the same way here and in production. The tree output and
            protocol messages are real.
          </p>
        </div>

        <div>
          <p className="text-on-surface font-medium mb-2">Try it — step by step</p>
          <div className="space-y-4 text-[13px]">

            <div>
              <p className="text-on-surface font-medium mb-1">1. State tree</p>
              <p className="mb-1">
                The tree panel shows what AI sees. Edit a todo's title in the
                editor and watch the tree update live. The protocol log shows
                a <code className="font-mono text-primary/70">patch</code> with
                the exact diff.
              </p>
            </div>

            <div>
              <p className="text-on-surface font-medium mb-1">2. Contextual affordances</p>
              <p className="mb-1">
                Actions live on the nodes they affect — not in a global list.
                Click <code className="font-mono text-primary/70">toggle</code> on
                a todo item. The handler runs, the tree updates,
                and the log shows{" "}
                <code className="font-mono text-primary/70">invoke</code> →{" "}
                <code className="font-mono text-primary/70">result</code> →{" "}
                <code className="font-mono text-primary/70">patch</code>.
              </p>
            </div>

            <div>
              <p className="text-on-surface font-medium mb-1">3. Typed parameters</p>
              <p className="mb-1">
                Click <code className="font-mono text-primary/70">create</code> on
                the collection or <code className="font-mono text-primary/70">rename</code> on
                an item. A param form appears — actions can require typed
                inputs. The AI fills these from context.
              </p>
            </div>

            <div>
              <p className="text-on-surface font-medium mb-1">4. Dangerous actions</p>
              <p className="mb-1">
                Click <code className="font-mono text-error/70">delete</code> (red).
                It prompts for confirmation. The{" "}
                <code className="font-mono text-primary/70">dangerous: true</code> flag
                tells AI to confirm before executing.
              </p>
            </div>

            <div>
              <p className="text-on-surface font-medium mb-1">5. Hierarchical registration</p>
              <p className="mb-1">
                Add a second <code className="font-mono text-primary/70">register()</code> call
                at a different path. Try:
              </p>
              <pre
                className="font-mono text-[12px] bg-surface-lowest rounded-sm p-2 leading-relaxed whitespace-pre overflow-x-auto mt-1"
                dangerouslySetInnerHTML={{ __html: highlight(`register("settings", {
  type: "group",
  props: { theme: "dark" },
  actions: {
    set_theme: {
      params: { theme: "string" },
      handler: () => {},
    },
  },
});`) }}
              />
              <p className="mt-1">
                The tree now has two top-level nodes. Each component
                registers its own slice — the engine assembles the full tree.
              </p>
            </div>

            <div>
              <p className="text-on-surface font-medium mb-1">6. Nested children</p>
              <p className="mb-1">
                Use <code className="font-mono text-primary/70">children</code> for
                inline subtrees or path-based nesting:
              </p>
              <pre
                className="font-mono text-[12px] bg-surface-lowest rounded-sm p-2 leading-relaxed whitespace-pre overflow-x-auto mt-1"
                dangerouslySetInnerHTML={{ __html: highlight(`register("inbox", {
  type: "view",
  children: {
    unread: {
      type: "status",
      props: { count: 5 },
    },
    compose: {
      type: "form",
      props: { draft: "" },
      actions: {
        send: {
          params: { body: "string" },
          handler: () => {},
        },
      },
    },
  },
});`) }}
              />
            </div>

            <div>
              <p className="text-on-surface font-medium mb-1">7. Attention hints</p>
              <p className="mb-1">
                Add <code className="font-mono text-primary/70">meta</code> to
                signal importance to the AI:
              </p>
              <pre
                className="font-mono text-[12px] bg-surface-lowest rounded-sm p-2 leading-relaxed whitespace-pre overflow-x-auto mt-1"
                dangerouslySetInnerHTML={{ __html: highlight(`// On an item:
meta: {
  salience: 1.0,  // high priority
  pinned: true,    // keep in view
  changed: true,   // recently modified
}`) }}
              />
            </div>

          </div>
        </div>

        <div className="mt-4">
          <p className="text-[13px] text-on-surface-variant mb-3">
            Done exploring? Add SLOP to your own app.
          </p>
          <a
            href="https://docs.slopai.dev/getting-started"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block font-mono text-[11px] uppercase tracking-wider text-primary px-4 py-2 rounded cta-glow transition-all hover:bg-primary/10"
            style={{ border: "1px solid var(--color-primary)" }}
          >
            Get started for real →
          </a>
        </div>
      </div>
    </div>
  );
}
