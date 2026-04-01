import { useCallback, useRef, useEffect, useState, useMemo } from "react";
import { highlight } from "./highlight";

const GUTTER_WIDTH = 44;

interface EditorProps {
  code: string;
  onChange: (code: string) => void;
  error: string | null;
}

export function Editor({ code, onChange, error }: EditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localCode, setLocalCode] = useState(code);

  const highlighted = useMemo(() => highlight(localCode), [localCode]);
  const lineCount = useMemo(() => localCode.split("\n").length, [localCode]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setLocalCode(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChange(value);
      }, 300);
    },
    [onChange],
  );

  // Sync external code changes (e.g., reset)
  useEffect(() => {
    setLocalCode(code);
    if (textareaRef.current && textareaRef.current.value !== code) {
      textareaRef.current.value = code;
    }
  }, [code]);

  // Sync scroll between textarea, highlighted pre, and gutter
  const handleScroll = useCallback(() => {
    if (!textareaRef.current) return;
    const { scrollTop, scrollLeft } = textareaRef.current;
    if (preRef.current) {
      preRef.current.scrollTop = scrollTop;
      preRef.current.scrollLeft = scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop;
    }
  }, []);

  // Handle tab key for indentation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = textarea.value;
        const newValue = value.substring(0, start) + "  " + value.substring(end);
        textarea.value = newValue;
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        setLocalCode(newValue);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          onChange(newValue);
        }, 300);
      }
    },
    [onChange],
  );

  const sharedStyle = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "14px",
    lineHeight: "1.6",
    tabSize: 2,
    whiteSpace: "pre" as const,
    wordWrap: "normal" as const,
    overflowWrap: "normal" as const,
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-1 relative min-h-0 overflow-hidden bg-surface-lowest">
        {/* Line number gutter */}
        <div
          ref={gutterRef}
          className="shrink-0 overflow-hidden select-none text-right pr-3 pt-3 pb-3"
          style={{
            ...sharedStyle,
            width: GUTTER_WIDTH,
            color: "var(--color-on-surface-variant)",
            opacity: 0.3,
            padding: undefined,
            paddingTop: 12,
            paddingBottom: 12,
            paddingRight: 8,
          }}
          aria-hidden="true"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* Code area */}
        <div className="relative flex-1 min-w-0">
          {/* Highlighted code (behind) */}
          <pre
            ref={preRef}
            className="absolute inset-0 m-0 overflow-hidden pointer-events-none"
            style={{ ...sharedStyle, padding: "12px 12px 12px 0" }}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: highlighted + "\n" }}
          />
          {/* Transparent textarea (in front, captures input) */}
          <textarea
            ref={textareaRef}
            value={localCode}
            onChange={handleChange}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            className="absolute inset-0 w-full h-full resize-none outline-none bg-transparent"
            style={{
              ...sharedStyle,
              padding: "12px 12px 12px 0",
              color: "transparent",
              caretColor: "var(--color-on-surface)",
            }}
          />
        </div>
      </div>
      {error && (
        <div className="px-3 py-2 font-mono text-xs text-error bg-error/8 shrink-0">
          {error}
        </div>
      )}
    </div>
  );
}
