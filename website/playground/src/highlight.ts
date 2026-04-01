/** Minimal JS syntax highlighter — produces HTML spans with color classes. */

const RULES: Array<[RegExp, string]> = [
  // Comments
  [/\/\/.*$/gm, "hl-comment"],
  [/\/\*[\s\S]*?\*\//g, "hl-comment"],
  // Strings (double, single, backtick)
  [/"(?:[^"\\]|\\.)*"/g, "hl-string"],
  [/'(?:[^'\\]|\\.)*'/g, "hl-string"],
  [/`(?:[^`\\]|\\.)*`/g, "hl-string"],
  // Numbers
  [/\b\d+(\.\d+)?\b/g, "hl-number"],
  // Keywords
  [/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|typeof|instanceof|in|of|true|false|null|undefined|this|class|export|import|from|default|try|catch|throw|finally|async|await|yield)\b/g, "hl-keyword"],
  // Arrow functions
  [/=>/g, "hl-keyword"],
  // Property keys (before colon in objects)
  [/\b([a-zA-Z_$][\w$]*)\s*(?=:)/g, "hl-property"],
  // Function calls
  [/\b([a-zA-Z_$][\w$]*)\s*(?=\()/g, "hl-function"],
];

interface Token {
  start: number;
  end: number;
  cls: string;
}

export function highlight(code: string): string {
  // Collect all token positions
  const tokens: Token[] = [];

  for (const [regex, cls] of RULES) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(code)) !== null) {
      tokens.push({ start: match.index, end: match.index + match[0].length, cls });
    }
  }

  // Sort by start position, earlier wins on overlap
  tokens.sort((a, b) => a.start - b.start);

  // Build HTML, skipping overlapping tokens
  let html = "";
  let cursor = 0;

  for (const token of tokens) {
    if (token.start < cursor) continue; // skip overlapping

    // Plain text before this token
    if (token.start > cursor) {
      html += escapeHtml(code.slice(cursor, token.start));
    }

    html += `<span class="${token.cls}">${escapeHtml(code.slice(token.start, token.end))}</span>`;
    cursor = token.end;
  }

  // Remaining plain text
  if (cursor < code.length) {
    html += escapeHtml(code.slice(cursor));
  }

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
