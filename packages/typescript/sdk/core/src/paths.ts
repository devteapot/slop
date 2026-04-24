const RESERVED_KEYWORDS = new Set(["properties", "children", "affordances", "meta", "content_ref", "id", "type"]);

export function escapeJsonPointerSegment(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function unescapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function validateNodeId(id: string): void {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("SLOP node id must be a non-empty string");
  }
  if (RESERVED_KEYWORDS.has(id)) {
    throw new Error(
      `SLOP node id "${id}" collides with a reserved field keyword (properties, children, affordances, meta, content_ref, id, type)`,
    );
  }
  if (id.includes("/") || id.includes("~")) {
    throw new Error(`SLOP node id "${id}" must not contain "/" or "~" — these are reserved in patch paths`);
  }
}

export function isValidNodeId(id: unknown): id is string {
  if (typeof id !== "string" || id.length === 0) return false;
  if (RESERVED_KEYWORDS.has(id)) return false;
  if (id.includes("/") || id.includes("~")) return false;
  return true;
}
