/**
 * Tier 3: Accessibility Tree Adapter
 *
 * Walks the DOM + ARIA attributes to build a SLOP tree from any webpage.
 * No app cooperation needed — works on any site.
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
let idCounter = 0;

function getElementId(el: Element): string {
  if (el.id) {
    elementMap.set(el.id, el);
    return el.id;
  }
  const id = `ax-${el.tagName.toLowerCase()}-${idCounter++}`;
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

  // Input subtypes
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    if (type === "checkbox" || type === "radio") return type;
    if (type === "submit" || type === "button") return "button";
    if (type === "search") return "searchbox";
    return "textbox";
  }

  return IMPLICIT_ROLES[tag] ?? "";
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

function getAccessibleName(el: Element): string {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
    if (parts.length) return parts.join(" ");
  }

  // For inputs, check associated label
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    if (el.labels?.length) return el.labels[0].textContent?.trim() ?? "";
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return placeholder;
  }

  // For images
  if (el instanceof HTMLImageElement) {
    return el.alt || el.title || "";
  }

  // For links and buttons, use text content
  if (["A", "BUTTON"].includes(el.tagName)) {
    return el.textContent?.trim()?.slice(0, 100) ?? "";
  }

  const title = el.getAttribute("title");
  if (title) return title;

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

function getAffordances(el: Element, role: string): SlopNode["affordances"] {
  const affordances: NonNullable<SlopNode["affordances"]> = [];

  if (["button", "link", "menuitem", "tab"].includes(role)) {
    const label = role === "link"
      ? `Navigate to ${(el as HTMLAnchorElement).href?.slice(0, 60) ?? "link"}`
      : getAccessibleName(el) || "Click";
    affordances.push({ action: "click", label });
  }

  if (["textbox", "searchbox"].includes(role)) {
    affordances.push({
      action: "fill",
      label: `Enter text in ${getAccessibleName(el) || "field"}`,
      params: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    });
  }

  if (role === "checkbox" || role === "radio") {
    const checked = (el as HTMLInputElement).checked;
    affordances.push({ action: "toggle", label: checked ? "Uncheck" : "Check" });
  }

  if (role === "combobox") {
    const options = el instanceof HTMLSelectElement
      ? Array.from(el.options).map(o => o.value)
      : [];
    affordances.push({
      action: "select",
      label: `Select option in ${getAccessibleName(el) || "dropdown"}`,
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

function isMeaningful(el: Element, role: string): boolean {
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

function walkElement(el: Element, depth: number): SlopNode | null {
  if (nodeCount >= MAX_NODES) return null;
  if (shouldSkip(el)) return null;

  const role = getRole(el);
  const meaningful = isMeaningful(el, role);

  // Only meaningful nodes count toward depth limit
  // Non-meaningful wrappers (divs, custom elements) are free
  if (meaningful && depth > MAX_DEPTH) return null;

  // Walk children
  const childNodes: SlopNode[] = [];
  for (const child of el.children) {
    const node = walkElement(child, meaningful ? depth + 1 : depth);
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

  const name = getAccessibleName(el);
  const desc = getDescription(el);
  const affordances = getAffordances(el, role);
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
  if (role === "checkbox" || role === "radio") {
    props.checked = (el as HTMLInputElement).checked;
  }
  if (role === "img" && el instanceof HTMLImageElement) {
    props.src = el.src;
    props.alt = el.alt;
  }

  const node: SlopNode = {
    id,
    type: roleToSlopType(role),
    ...(Object.keys(props).length > 0 && { properties: props }),
    ...(childNodes.length > 0 && { children: childNodes }),
    ...(affordances && { affordances }),
  };

  return node;
}

export function buildAxTree(): SlopNode {
  elementMap.clear();
  idCounter = 0;
  nodeCount = 0;

  // Always start from body — let the walker find meaningful elements
  // at any depth (non-meaningful wrappers don't count toward depth limit)
  const root = document.body;

  const children: SlopNode[] = [];
  for (const child of root.children) {
    const node = walkElement(child, 1);
    if (node) children.push(node);
  }

  return {
    id: "ax-root",
    type: "root",
    properties: { label: document.title },
    ...(children.length > 0 && { children }),
    meta: { summary: `${nodeCount} elements scanned from ${document.title}` },
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
          el.value = value;
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
