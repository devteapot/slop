/**
 * Tier 3: Accessibility Tree Adapter
 *
 * Walks the DOM + ARIA attributes to build a SLOP tree from any webpage.
 * No app cooperation needed — works on any site.
 *
 * Snapshot heuristics are aligned with vercel-labs/agent-browser's snapshot
 * pipeline (interactive roles, cursor-interactive elements, ref ids, name
 * sanitization). We cannot use CDP Accessibility.getFullAXTree from a content
 * script; this stays a DOM+ARIA implementation of the same ideas.
 *
 * Triggered by "Scan this page" in the extension popup.
 */

// --- Types ---

interface SlopNode {
  id: string;
  type: string;
  properties?: Record<string, unknown>;
  children?: SlopNode[];
  affordances?: { action: string; label?: string; description?: string; params?: any; dangerous?: boolean }[];
  meta?: Record<string, unknown>;
}

// --- Element → ID mapping (for invoke resolution) ---

const elementMap = new Map<string, Element>();
let refCounter = 0;

/** Matches agent-browser snapshot.rs INVISIBLE_CHARS (screen-reader noise). */
const INVISIBLE_CHARS = /[\uFEFF\u200B\u200C\u200D\u2060\u00A0]/g;

function sanitizeAccessibleString(s: string): string {
  return s.replace(INVISIBLE_CHARS, "").trim();
}

/**
 * Roles that agent-browser treats as interactive for refs (snapshot.rs INTERACTIVE_ROLES).
 * Used to classify native ARIA roles and to skip them in the cursor-interactive pass.
 */
const AB_INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "treeitem",
]);

interface CursorElementInfo {
  kind: "clickable" | "editable" | "focusable";
  hints: string[];
  text: string;
}

/**
 * Elements that behave interactively but may lack proper roles (cursor:pointer, onclick, etc.).
 * Ported from agent-browser find_cursor_interactive_elements (snapshot.rs).
 */
function findCursorInteractiveElements(root: HTMLElement): Map<Element, CursorElementInfo> {
  const out = new Map<Element, CursorElementInfo>();
  const interactiveTags = new Set([
    "a",
    "button",
    "input",
    "select",
    "textarea",
    "details",
    "summary",
  ]);

  const all = root.querySelectorAll("*");
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (!(el instanceof HTMLElement)) continue;
    if (el.closest("[hidden], [aria-hidden=\"true\"]")) continue;

    const tagName = el.tagName.toLowerCase();
    if (interactiveTags.has(tagName)) continue;

    const roleAttr = el.getAttribute("role")?.toLowerCase();
    if (roleAttr && AB_INTERACTIVE_ROLES.has(roleAttr)) continue;

    const computedStyle = getComputedStyle(el);
    const hasCursorPointer = computedStyle.cursor === "pointer";
    const hasOnClick = el.hasAttribute("onclick") || (el as HTMLElement & { onclick?: unknown }).onclick != null;
    const tabIndex = el.getAttribute("tabindex");
    const hasTabIndex = tabIndex !== null && tabIndex !== "-1";
    const ce = el.getAttribute("contenteditable");
    const isEditable = ce === "" || ce === "true";

    if (!hasCursorPointer && !hasOnClick && !hasTabIndex && !isEditable) continue;

    if (hasCursorPointer && !hasOnClick && !hasTabIndex && !isEditable) {
      const parent = el.parentElement;
      if (parent && getComputedStyle(parent).cursor === "pointer") continue;
    }

    const text = sanitizeAccessibleString((el.textContent || "").slice(0, 100));
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const kind: CursorElementInfo["kind"] =
      hasCursorPointer || hasOnClick ? "clickable" : isEditable ? "editable" : "focusable";
    const hints: string[] = [];
    if (hasCursorPointer) hints.push("cursor:pointer");
    if (hasOnClick) hints.push("onclick");
    if (hasTabIndex) hints.push("tabindex");
    if (isEditable) hints.push("contenteditable");

    out.set(el, { kind, hints, text });
  }
  return out;
}

function getElementId(el: Element): string {
  if (el.id) {
    elementMap.set(el.id, el);
    return el.id;
  }
  const id = `e${refCounter++}`;
  elementMap.set(id, el);
  return id;
}

export function resolveElement(id: string): Element | null {
  return elementMap.get(id) ?? null;
}

// --- Role mapping ---

const IMPLICIT_ROLES: Record<string, string> = {
  MAIN: "main",
  NAV: "navigation",
  ASIDE: "complementary",
  HEADER: "banner",
  FOOTER: "contentinfo",
  FORM: "form",
  BUTTON: "button",
  A: "link",
  INPUT: "textbox",
  TEXTAREA: "textbox",
  SELECT: "combobox",
  UL: "list",
  OL: "list",
  LI: "listitem",
  TABLE: "table",
  TR: "row",
  H1: "heading",
  H2: "heading",
  H3: "heading",
  H4: "heading",
  H5: "heading",
  H6: "heading",
  IMG: "img",
  DIALOG: "dialog",
  DETAILS: "group",
  SECTION: "region",
  ARTICLE: "article",
};

function getRole(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;

  const tag = el.tagName;

  // Input subtypes (aligned with common ARIA roles from agent-browser / AX)
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    if (type === "checkbox" || type === "radio") return type;
    if (type === "submit" || type === "button" || type === "reset") return "button";
    if (type === "search") return "searchbox";
    if (type === "range") return "slider";
    if (type === "number") return "spinbutton";
    if (type === "color") return "textbox";
    return "textbox";
  }

  return IMPLICIT_ROLES[tag] ?? "";
}

function roleFromCursorHint(cursor: CursorElementInfo | undefined): string {
  if (!cursor) return "";
  if (cursor.kind === "editable") return "textbox";
  return "button";
}

const ROLE_TO_SLOP: Record<string, string> = {
  main: "view",
  region: "view",
  article: "view",
  dialog: "view",
  navigation: "group",
  complementary: "group",
  banner: "group",
  contentinfo: "group",
  group: "group",
  list: "collection",
  listitem: "item",
  table: "collection",
  row: "item",
  button: "control",
  link: "control",
  menuitem: "control",
  tab: "control",
  textbox: "field",
  searchbox: "field",
  combobox: "field",
  checkbox: "field",
  radio: "field",
  slider: "field",
  spinbutton: "field",
  switch: "field",
  listbox: "field",
  option: "item",
  treeitem: "item",
  form: "form",
  heading: "status",
  status: "notification",
  alert: "notification",
  img: "media",
};

function roleToSlopType(role: string): string {
  return ROLE_TO_SLOP[role] ?? "group";
}

// --- Accessible name ---

function getAccessibleName(el: Element, cursorFallback?: CursorElementInfo): string {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return sanitizeAccessibleString(ariaLabel);

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
    if (parts.length) return sanitizeAccessibleString(parts.join(" "));
  }

  // For inputs, check associated label
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    if (el.labels?.length) return sanitizeAccessibleString(el.labels[0].textContent?.trim() ?? "");
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return sanitizeAccessibleString(placeholder);
  }

  // For images
  if (el instanceof HTMLImageElement) {
    const n = el.alt || el.title || "";
    if (n) return sanitizeAccessibleString(n);
  }

  // For links and buttons, use text content
  if (["A", "BUTTON"].includes(el.tagName)) {
    return sanitizeAccessibleString(el.textContent?.trim()?.slice(0, 100) ?? "");
  }

  const title = el.getAttribute("title");
  if (title) return sanitizeAccessibleString(title);

  if (cursorFallback?.text) return sanitizeAccessibleString(cursorFallback.text);

  return "";
}

// --- Contextual description ---

function getDescription(el: Element): string {
  const describedBy = el.getAttribute("aria-describedby");
  if (describedBy) {
    const parts = describedBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
    if (parts.length) return parts.join(" ");
  }

  const title = el.getAttribute("title");
  if (title && title !== getAccessibleName(el)) return title;

  // Nearest heading context
  let parent = el.parentElement;
  while (parent) {
    const heading = parent.querySelector("h1, h2, h3, h4, h5, h6");
    if (heading && heading !== el) {
      return `In "${heading.textContent?.trim()?.slice(0, 60)}" section`;
    }
    if (parent.getAttribute("aria-label")) {
      return `In ${parent.getAttribute("aria-label")}`;
    }
    parent = parent.parentElement;
  }

  return "";
}

// --- Affordance extraction ---

function getAffordances(
  el: Element,
  role: string,
  cursor: CursorElementInfo | undefined,
): SlopNode["affordances"] {
  const affordances: NonNullable<SlopNode["affordances"]> = [];
  const name = getAccessibleName(el, cursor);

  if (["button", "link", "menuitem", "tab"].includes(role)) {
    const label = role === "link"
      ? `Navigate to ${(el as HTMLAnchorElement).href?.slice(0, 60) ?? "link"}`
      : name || "Click";
    affordances.push({ action: "click", label });
  }

  if (["textbox", "searchbox"].includes(role)) {
    affordances.push({
      action: "fill",
      label: `Enter text in ${name || "field"}`,
      params: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    });
  }

  if (role === "checkbox" || role === "radio") {
    const checked = (el as HTMLInputElement).checked;
    affordances.push({ action: "toggle", label: checked ? "Uncheck" : "Check" });
  }

  if (role === "slider" || role === "spinbutton") {
    affordances.push({
      action: "fill",
      label: `Set value for ${name || role}`,
      params: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    });
  }

  if (role === "switch") {
    affordances.push({ action: "toggle", label: name || "Toggle" });
  }

  if (role === "combobox") {
    const options = el instanceof HTMLSelectElement
      ? Array.from(el.options).map(o => o.value)
      : [];
    affordances.push({
      action: "select",
      label: `Select option in ${name || "dropdown"}`,
      params: {
        type: "object",
        properties: { value: { type: "string", ...(options.length && { enum: options }) } },
        required: ["value"],
      },
    });
  }

  const expanded = el.getAttribute("aria-expanded");
  if (expanded === "true") affordances.push({ action: "collapse" });
  if (expanded === "false") affordances.push({ action: "expand" });

  if (role === "form") {
    affordances.push({ action: "submit", label: "Submit form" });
  }

  // Cursor-only interactive (div with onclick, etc.)
  if (affordances.length === 0 && cursor) {
    if (cursor.kind === "editable" || role === "textbox") {
      affordances.push({
        action: "fill",
        label: `Enter text in ${name || "field"}`,
        params: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
      });
    } else {
      affordances.push({
        action: "click",
        label: name || `Click (${cursor.kind})`,
      });
    }
  }

  return affordances.length > 0 ? affordances : undefined;
}

// --- Should skip element ---

function shouldSkip(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true;

  const tag = el.tagName;
  if (["SCRIPT", "STYLE", "META", "LINK", "NOSCRIPT", "BR", "HR", "WBR"].includes(tag)) return true;

  if (el.getAttribute("aria-hidden") === "true") return true;

  const role = el.getAttribute("role");
  if (role === "presentation" || role === "none") return true;

  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return true;

  return false;
}

// --- Is semantically meaningful ---

function isMeaningful(el: Element, role: string, cursorMap: ReadonlyMap<Element, CursorElementInfo>): boolean {
  if (cursorMap.has(el)) return true;

  // Has a mapped ARIA role
  if (role && ROLE_TO_SLOP[role]) return true;

  // Interactive HTML elements (even without explicit role)
  const tag = el.tagName;
  if (["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT", "DETAILS", "SUMMARY"].includes(tag)) return true;

  // Has an aria-label (developer marked it as meaningful)
  if (el.getAttribute("aria-label")) return true;

  // Has a role attribute (even if not in our mapping)
  if (el.getAttribute("role")) return true;

  // Semantic HTML tags
  if (["MAIN", "NAV", "ASIDE", "HEADER", "FOOTER", "SECTION", "ARTICLE", "FORM",
       "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "TABLE", "IMG", "FIGURE"].includes(tag)) return true;

  return false;
}

// --- Walk DOM → SLOP tree ---

const MAX_DEPTH = 8;
const MAX_NODES = 300;
let nodeCount = 0;

function walkElement(el: Element, depth: number, cursorMap: ReadonlyMap<Element, CursorElementInfo>): SlopNode | null {
  if (nodeCount >= MAX_NODES) return null;
  if (shouldSkip(el)) return null;

  const cursor = cursorMap.get(el);
  const rawRole = getRole(el);
  const role = rawRole || roleFromCursorHint(cursor);
  const meaningful = isMeaningful(el, rawRole, cursorMap);

  // Only meaningful nodes count toward depth limit
  // Non-meaningful wrappers (divs, custom elements) are free
  if (meaningful && depth > MAX_DEPTH) return null;

  // Walk children
  const childNodes: SlopNode[] = [];
  for (const child of el.children) {
    const node = walkElement(child, meaningful ? depth + 1 : depth, cursorMap);
    if (node) childNodes.push(node);
  }

  // If this element isn't meaningful, pass through its children
  if (!meaningful) {
    if (childNodes.length === 0) return null;
    if (childNodes.length === 1) return childNodes[0];
    // Multiple meaningful children under a non-meaningful wrapper —
    // create a transparent group to hold them
    nodeCount++;
    return {
      id: getElementId(el),
      type: "group",
      children: childNodes,
    };
  }

  nodeCount++;

  const name = getAccessibleName(el, cursor);
  const desc = getDescription(el);
  const affordances = getAffordances(el, role, cursor);
  const id = getElementId(el);

  const props: Record<string, unknown> = {};
  if (name) props.label = name;
  if (desc) props.description = desc;

  // Extra props for specific roles
  if (role === "heading") {
    props.level = parseInt(el.tagName[1]) || 2;
  }
  if (role === "link" && el instanceof HTMLAnchorElement) {
    props.href = el.href;
  }
  if (["textbox", "searchbox"].includes(role)) {
    props.value = (el as HTMLInputElement).value || "";
  }
  if (role === "checkbox" || role === "radio" || role === "switch") {
    props.checked = (el as HTMLInputElement).checked;
  }
  if (role === "slider" || role === "spinbutton") {
    props.value = String((el as HTMLInputElement).value ?? "");
  }
  if (role === "img" && el instanceof HTMLImageElement) {
    props.src = el.src;
    props.alt = el.alt;
  }

  const meta: Record<string, unknown> | undefined = cursor
    ? { cursor: cursor.kind, cursorHints: cursor.hints }
    : undefined;

  const node: SlopNode = {
    id,
    type: roleToSlopType(role),
    ...(Object.keys(props).length > 0 && { properties: props }),
    ...(childNodes.length > 0 && { children: childNodes }),
    ...(affordances && { affordances }),
    ...(meta && { meta }),
  };

  return node;
}

export interface AxBuildOptions {
  /**
   * `full` — hierarchical tree (default).
   * `interactive` — flat list of nodes with affordances only (agent-browser `--interactive`-style; smaller payloads).
   */
  mode?: "full" | "interactive";
}

function buildSlopNodeForElement(
  el: Element,
  cursor: CursorElementInfo | undefined,
): SlopNode | null {
  const rawRole = getRole(el);
  const role = rawRole || roleFromCursorHint(cursor);
  const affordances = getAffordances(el, role, cursor);
  if (!affordances) return null;

  const name = getAccessibleName(el, cursor);
  const desc = getDescription(el);
  const id = getElementId(el);

  const props: Record<string, unknown> = {};
  if (name) props.label = name;
  if (desc) props.description = desc;

  if (role === "heading") {
    props.level = parseInt(el.tagName[1]) || 2;
  }
  if (role === "link" && el instanceof HTMLAnchorElement) {
    props.href = el.href;
  }
  if (["textbox", "searchbox"].includes(role)) {
    props.value = (el as HTMLInputElement).value || "";
  }
  if (role === "checkbox" || role === "radio" || role === "switch") {
    props.checked = (el as HTMLInputElement).checked;
  }
  if (role === "slider" || role === "spinbutton") {
    props.value = String((el as HTMLInputElement).value ?? "");
  }
  if (role === "img" && el instanceof HTMLImageElement) {
    props.src = el.src;
    props.alt = el.alt;
  }

  const meta: Record<string, unknown> | undefined = cursor
    ? { cursor: cursor.kind, cursorHints: cursor.hints }
    : undefined;

  return {
    id,
    type: roleToSlopType(role),
    ...(Object.keys(props).length > 0 && { properties: props }),
    affordances,
    ...(meta && { meta }),
  };
}

/** Flat snapshot: only elements with affordances, document order (cf. agent-browser interactive snapshot). */
function buildInteractiveFlat(cursorMap: ReadonlyMap<Element, CursorElementInfo>): SlopNode {
  elementMap.clear();
  refCounter = 0;
  nodeCount = 0;

  const candidates = new Set<Element>();
  for (const el of document.querySelectorAll(
    "a[href], button, input, textarea, select, summary, [role], [tabindex]:not([tabindex=\"-1\"])",
  )) {
    if (!(el instanceof HTMLElement)) continue;
    if (shouldSkip(el)) continue;
    candidates.add(el);
  }
  for (const el of cursorMap.keys()) {
    if (!shouldSkip(el)) candidates.add(el);
  }

  const sorted = Array.from(candidates).sort((a, b) => {
    const p = a.compareDocumentPosition(b);
    if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  const children: SlopNode[] = [];
  for (const el of sorted) {
    if (nodeCount >= MAX_NODES) break;
    const cursor = cursorMap.get(el);
    const node = buildSlopNodeForElement(el, cursor);
    if (!node) continue;
    nodeCount++;
    children.push(node);
  }

  return {
    id: "ax-root",
    type: "root",
    properties: { label: document.title },
    ...(children.length > 0 && { children }),
    meta: {
      summary: `${nodeCount} interactive elements from ${document.title}`,
      snapshotMode: "interactive",
    },
  };
}

export function buildAxTree(options?: AxBuildOptions): SlopNode {
  const cursorMap = document.body
    ? findCursorInteractiveElements(document.body)
    : new Map<Element, CursorElementInfo>();

  if (options?.mode === "interactive") {
    return buildInteractiveFlat(cursorMap);
  }

  elementMap.clear();
  refCounter = 0;
  nodeCount = 0;

  // Always start from body — let the walker find meaningful elements
  // at any depth (non-meaningful wrappers don't count toward depth limit)
  const root = document.body;

  const children: SlopNode[] = [];
  if (root) {
    for (const child of root.children) {
      const node = walkElement(child, 1, cursorMap);
      if (node) children.push(node);
    }
  }

  return {
    id: "ax-root",
    type: "root",
    properties: { label: document.title },
    ...(children.length > 0 && { children }),
    meta: {
      summary: `${nodeCount} elements scanned from ${document.title}`,
      snapshotMode: "full",
      cursorInteractiveCount: cursorMap.size,
    },
  };
}

// --- Change detection ---

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function observeChanges(callback: (tree: SlopNode) => void): () => void {
  observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      callback(buildAxTree());
    }, 200);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["role", "aria-label", "aria-expanded", "aria-checked", "aria-hidden", "value", "checked", "disabled"],
  });

  return () => {
    observer?.disconnect();
    observer = null;
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}

// --- Action execution ---

export function executeAction(nodeId: string, action: string, params?: Record<string, unknown>): { status: string; message?: string } {
  const el = resolveElement(nodeId);
  if (!el) return { status: "error", message: `Element ${nodeId} not found` };

  try {
    switch (action) {
      case "click":
        (el as HTMLElement).click();
        return { status: "ok" };

      case "fill": {
        const value = (params?.value as string) ?? "";
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          if (el.type === "number" || el.type === "range") {
            const n = Number(value);
            el.value = Number.isFinite(n) ? String(n) : value;
          } else {
            el.value = value;
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return { status: "ok" };
      }

      case "toggle":
        (el as HTMLElement).click();
        return { status: "ok" };

      case "select": {
        const value = (params?.value as string) ?? "";
        if (el instanceof HTMLSelectElement) {
          el.value = value;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return { status: "ok" };
      }

      case "submit":
        if (el instanceof HTMLFormElement) {
          el.submit();
        } else {
          const form = el.closest("form");
          if (form) form.submit();
        }
        return { status: "ok" };

      case "expand":
      case "collapse":
        (el as HTMLElement).click();
        return { status: "ok" };

      default:
        return { status: "error", message: `Unknown action: ${action}` };
    }
  } catch (err: any) {
    return { status: "error", message: err.message };
  }
}
