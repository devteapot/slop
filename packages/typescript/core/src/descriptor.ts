import type {
  SlopNode, Affordance, JsonSchema, ActionHandler, NodeMeta, ContentRef,
  NodeDescriptor, ItemDescriptor, Action, ParamDef,
} from "./types";

export interface NormalizationResult {
  node: SlopNode;
  handlers: Map<string, ActionHandler>;
}

/**
 * Convert a developer-friendly NodeDescriptor into a wire-format SlopNode
 * and extract action handlers into a flat map keyed by "{path}/{action}".
 */
export function normalizeDescriptor(
  path: string,
  id: string,
  descriptor: NodeDescriptor
): NormalizationResult {
  const handlers = new Map<string, ActionHandler>();
  const children: SlopNode[] = [];

  // Build meta from explicit meta + summary + window metadata
  const meta: Partial<NodeMeta> = { ...descriptor.meta };
  if (descriptor.summary) meta.summary = descriptor.summary;

  // Convert windowed collection OR items → children
  if (descriptor.window) {
    // Windowed: only include the window slice
    for (const item of descriptor.window.items) {
      const itemPath = path ? `${path}/${item.id}` : item.id;
      const { node: itemNode, handlers: itemHandlers } = normalizeItem(itemPath, item);
      children.push(itemNode);
      for (const [k, v] of itemHandlers) handlers.set(k, v);
    }
    meta.total_children = descriptor.window.total;
    meta.window = [descriptor.window.offset, descriptor.window.items.length];
  } else if (descriptor.items) {
    for (const item of descriptor.items) {
      const itemPath = path ? `${path}/${item.id}` : item.id;
      const { node: itemNode, handlers: itemHandlers } = normalizeItem(itemPath, item);
      children.push(itemNode);
      for (const [k, v] of itemHandlers) handlers.set(k, v);
    }
  }

  // Convert inline children → children (recursive)
  if (descriptor.children) {
    for (const [childId, childDesc] of Object.entries(descriptor.children)) {
      const childPath = path ? `${path}/${childId}` : childId;
      const { node: childNode, handlers: childHandlers } = normalizeDescriptor(
        childPath, childId, childDesc
      );
      children.push(childNode);
      for (const [k, v] of childHandlers) handlers.set(k, v);
    }
  }

  // Convert actions → affordances + extract handlers
  const affordances = normalizeActions(path, descriptor.actions, handlers);

  const properties = descriptor.props ? { ...descriptor.props } : undefined;

  // Build content_ref as top-level field (per spec 13)
  let content_ref: ContentRef | undefined;
  if (descriptor.contentRef) {
    content_ref = {
      ...descriptor.contentRef,
      uri: descriptor.contentRef.uri ?? `slop://content/${path}`,
    };
  }

  const node: SlopNode = {
    id,
    type: descriptor.type,
    ...(properties && { properties }),
    ...(children.length > 0 && { children }),
    ...(affordances.length > 0 && { affordances }),
    ...(Object.keys(meta).length > 0 && { meta }),
    ...(content_ref && { content_ref }),
  };

  return { node, handlers };
}

function normalizeItem(
  path: string,
  item: ItemDescriptor
): NormalizationResult {
  const handlers = new Map<string, ActionHandler>();
  const children: SlopNode[] = [];

  // Item can have inline children too
  if (item.children) {
    for (const [childId, childDesc] of Object.entries(item.children)) {
      const childPath = `${path}/${childId}`;
      const { node, handlers: h } = normalizeDescriptor(childPath, childId, childDesc);
      children.push(node);
      for (const [k, v] of h) handlers.set(k, v);
    }
  }

  const affordances = normalizeActions(path, item.actions, handlers);

  const meta: Partial<NodeMeta> = { ...item.meta };
  if (item.summary) meta.summary = item.summary;

  const node: SlopNode = {
    id: item.id,
    type: "item",
    ...(item.props && { properties: item.props }),
    ...(children.length > 0 && { children }),
    ...(affordances.length > 0 && { affordances }),
    ...(Object.keys(meta).length > 0 && { meta }),
  };

  return { node, handlers };
}

function normalizeActions(
  path: string,
  actions: Record<string, Action> | undefined,
  handlers: Map<string, ActionHandler>
): Affordance[] {
  if (!actions) return [];
  const affordances: Affordance[] = [];

  for (const [name, action] of Object.entries(actions)) {
    const handlerKey = path ? `${path}/${name}` : name;

    if (typeof action === "function") {
      // Bare callback
      handlers.set(handlerKey, action);
      affordances.push({ action: name });
    } else {
      // Full ActionDescriptor
      handlers.set(handlerKey, action.handler);
      affordances.push({
        action: name,
        ...(action.label && { label: action.label }),
        ...(action.description && { description: action.description }),
        ...(action.dangerous && { dangerous: true }),
        ...(action.idempotent && { idempotent: true }),
        ...(action.estimate && { estimate: action.estimate }),
        ...(action.params && { params: normalizeParams(action.params) }),
      });
    }
  }

  return affordances;
}

/** Convert simplified params { title: "string" } to JSON Schema */
function normalizeParams(params: Record<string, ParamDef>): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const [key, def] of Object.entries(params)) {
    if (typeof def === "string") {
      properties[key] = { type: def };
    } else {
      properties[key] = {
        type: def.type,
        ...(def.description && { description: def.description }),
        ...(def.enum && { enum: def.enum }),
      };
    }
    required.push(key);
  }

  return { type: "object", properties, required };
}
