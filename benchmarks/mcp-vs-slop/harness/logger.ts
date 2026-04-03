let _verbose = false;

export function setVerbose(v: boolean) {
  _verbose = v;
}

export function isVerbose(): boolean {
  return _verbose;
}

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

export function verbose(protocol: string, ...args: unknown[]) {
  if (!_verbose) return;
  const tag = `${COLORS.dim}[${protocol}]${COLORS.reset}`;
  console.log(tag, ...args);
}

export function verboseToolCall(protocol: string, name: string, args?: unknown) {
  if (!_verbose) return;
  const argsStr = args ? ` ${COLORS.dim}${JSON.stringify(args).slice(0, 200)}${COLORS.reset}` : "";
  console.log(`  ${COLORS.cyan}→ ${name}${COLORS.reset}${argsStr}`);
}

export function verboseToolResult(protocol: string, name: string, result: unknown) {
  if (!_verbose) return;
  const str = JSON.stringify(result);
  const truncated = str.length > 300 ? str.slice(0, 297) + "..." : str;
  console.log(`  ${COLORS.green}← ${name}${COLORS.reset} ${COLORS.dim}${truncated}${COLORS.reset}`);
}

export function verboseLlmTurn(protocol: string, turn: number, text?: string) {
  if (!_verbose) return;
  const label = `${COLORS.yellow}LLM turn ${turn}${COLORS.reset}`;
  if (text) {
    const truncated = text.length > 200 ? text.slice(0, 197) + "..." : text;
    console.log(`  ${label} ${COLORS.dim}${truncated}${COLORS.reset}`);
  } else {
    console.log(`  ${label}`);
  }
}

export function verboseVerification(protocol: string, passed: boolean, details: string) {
  if (!_verbose) return;
  const icon = passed ? `${COLORS.green}✓${COLORS.reset}` : `${COLORS.red}✗${COLORS.reset}`;
  console.log(`  ${icon} ${details}`);
}
