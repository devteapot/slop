import {
  __objRest,
  __spreadProps,
  __spreadValues
} from "./chunk-GOMI4DH3.js";

// ../../../packages/typescript/core/dist/index.js
function normalizeDescriptor(path, id, descriptor) {
  const handlers = /* @__PURE__ */ new Map();
  const children = [];
  const meta = __spreadValues({}, descriptor.meta);
  if (descriptor.summary) meta.summary = descriptor.summary;
  if (descriptor.window) {
    for (const item of descriptor.window.items) {
      const itemPath = path ? `${path}/${item.id}` : item.id;
      const {
        node: itemNode,
        handlers: itemHandlers
      } = normalizeItem(itemPath, item);
      children.push(itemNode);
      for (const [k, v] of itemHandlers) handlers.set(k, v);
    }
    meta.total_children = descriptor.window.total;
    meta.window = [descriptor.window.offset, descriptor.window.items.length];
  } else if (descriptor.items) {
    for (const item of descriptor.items) {
      const itemPath = path ? `${path}/${item.id}` : item.id;
      const {
        node: itemNode,
        handlers: itemHandlers
      } = normalizeItem(itemPath, item);
      children.push(itemNode);
      for (const [k, v] of itemHandlers) handlers.set(k, v);
    }
  }
  if (descriptor.children) {
    for (const [childId, childDesc] of Object.entries(descriptor.children)) {
      const childPath = path ? `${path}/${childId}` : childId;
      const {
        node: childNode,
        handlers: childHandlers
      } = normalizeDescriptor(childPath, childId, childDesc);
      children.push(childNode);
      for (const [k, v] of childHandlers) handlers.set(k, v);
    }
  }
  const affordances = normalizeActions(path, descriptor.actions, handlers);
  const properties = descriptor.props ? __spreadValues({}, descriptor.props) : void 0;
  let content_ref;
  if (descriptor.contentRef) {
    content_ref = __spreadProps(__spreadValues({}, descriptor.contentRef), {
      uri: descriptor.contentRef.uri ?? `slop://content/${path}`
    });
  }
  const node = __spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues({
    id,
    type: descriptor.type
  }, properties && {
    properties
  }), children.length > 0 && {
    children
  }), affordances.length > 0 && {
    affordances
  }), Object.keys(meta).length > 0 && {
    meta
  }), content_ref && {
    content_ref
  });
  return {
    node,
    handlers
  };
}
function normalizeItem(path, item) {
  const handlers = /* @__PURE__ */ new Map();
  const children = [];
  if (item.children) {
    for (const [childId, childDesc] of Object.entries(item.children)) {
      const childPath = `${path}/${childId}`;
      const {
        node: node2,
        handlers: h
      } = normalizeDescriptor(childPath, childId, childDesc);
      children.push(node2);
      for (const [k, v] of h) handlers.set(k, v);
    }
  }
  const affordances = normalizeActions(path, item.actions, handlers);
  const meta = __spreadValues({}, item.meta);
  if (item.summary) meta.summary = item.summary;
  let content_ref;
  if (item.contentRef) {
    content_ref = __spreadProps(__spreadValues({}, item.contentRef), {
      uri: item.contentRef.uri ?? `slop://content/${path}`
    });
  }
  const node = __spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues({
    id: item.id,
    type: "item"
  }, item.props && {
    properties: item.props
  }), children.length > 0 && {
    children
  }), affordances.length > 0 && {
    affordances
  }), Object.keys(meta).length > 0 && {
    meta
  }), content_ref && {
    content_ref
  });
  return {
    node,
    handlers
  };
}
function normalizeActions(path, actions, handlers) {
  if (!actions) return [];
  const affordances = [];
  for (const [name, action2] of Object.entries(actions)) {
    const handlerKey = path ? `${path}/${name}` : name;
    if (typeof action2 === "function") {
      handlers.set(handlerKey, action2);
      affordances.push({
        action: name
      });
    } else {
      handlers.set(handlerKey, action2.handler);
      affordances.push(__spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues({
        action: name
      }, action2.label && {
        label: action2.label
      }), action2.description && {
        description: action2.description
      }), action2.dangerous && {
        dangerous: true
      }), action2.idempotent && {
        idempotent: true
      }), action2.estimate && {
        estimate: action2.estimate
      }), action2.params && {
        params: normalizeParams(action2.params)
      }));
    }
  }
  return affordances;
}
function normalizeParams(params) {
  const properties = {};
  const required = [];
  for (const [key, def] of Object.entries(params)) {
    if (typeof def === "string") {
      properties[key] = {
        type: def
      };
    } else {
      properties[key] = __spreadValues(__spreadValues(__spreadValues({
        type: def.type
      }, def.description && {
        description: def.description
      }), def.enum && {
        enum: def.enum
      }), def.items && {
        items: def.items
      });
    }
    required.push(key);
  }
  return {
    type: "object",
    properties,
    required
  };
}
function assembleTree(registrations, rootId, rootName) {
  const allHandlers = /* @__PURE__ */ new Map();
  const nodesByPath = /* @__PURE__ */ new Map();
  const sortedPaths = [...registrations.keys()].sort((a, b) => {
    const depthA = a.split("/").length;
    const depthB = b.split("/").length;
    return depthA !== depthB ? depthA - depthB : a.localeCompare(b);
  });
  for (const path of sortedPaths) {
    const descriptor = registrations.get(path);
    const id = path.split("/").pop();
    const {
      node,
      handlers
    } = normalizeDescriptor(path, id, descriptor);
    nodesByPath.set(path, node);
    for (const [k, v] of handlers) allHandlers.set(k, v);
  }
  const root = {
    id: rootId,
    type: "root",
    properties: {
      label: rootName
    },
    children: []
  };
  for (const path of sortedPaths) {
    const node = nodesByPath.get(path);
    const parentPath = getParentPath(path);
    if (parentPath === "") {
      addChild(root, node);
    } else {
      const parent = ensureNode(parentPath, nodesByPath, root);
      addChild(parent, node);
    }
  }
  return {
    tree: root,
    handlers: allHandlers
  };
}
function getParentPath(path) {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "" : path.substring(0, lastSlash);
}
function ensureNode(path, nodesByPath, root) {
  const existing = nodesByPath.get(path);
  if (existing) return existing;
  const id = path.split("/").pop();
  const synthetic = {
    id,
    type: "group",
    children: []
  };
  nodesByPath.set(path, synthetic);
  const parentPath = getParentPath(path);
  if (parentPath === "") {
    addChild(root, synthetic);
  } else {
    const parent = ensureNode(parentPath, nodesByPath, root);
    addChild(parent, synthetic);
  }
  return synthetic;
}
function addChild(parent, child) {
  if (!parent.children) parent.children = [];
  const existingIdx = parent.children.findIndex((c) => c.id === child.id);
  if (existingIdx !== -1) {
    const existing = parent.children[existingIdx];
    if (existing.type === "group" && !existing.properties) {
      if (existing.children?.length && !child.children?.length) {
        child.children = existing.children;
      } else if (existing.children?.length && child.children?.length) {
        const childIds = new Set(child.children.map((c) => c.id));
        for (const ec of existing.children) {
          if (!childIds.has(ec.id)) {
            child.children.push(ec);
          }
        }
      }
    }
    parent.children[existingIdx] = child;
  } else {
    parent.children.push(child);
  }
}
function diffNodes(oldNode, newNode, basePath = "") {
  const ops = [];
  const oldProps = oldNode.properties ?? {};
  const newProps = newNode.properties ?? {};
  const allKeys = /* @__PURE__ */ new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
  for (const key of allKeys) {
    const oldVal = oldProps[key];
    const newVal = newProps[key];
    if (oldVal === void 0 && newVal !== void 0) {
      ops.push({
        op: "add",
        path: `${basePath}/properties/${key}`,
        value: newVal
      });
    } else if (oldVal !== void 0 && newVal === void 0) {
      ops.push({
        op: "remove",
        path: `${basePath}/properties/${key}`
      });
    } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      ops.push({
        op: "replace",
        path: `${basePath}/properties/${key}`,
        value: newVal
      });
    }
  }
  if (JSON.stringify(oldNode.affordances) !== JSON.stringify(newNode.affordances)) {
    if (newNode.affordances) {
      ops.push({
        op: oldNode.affordances ? "replace" : "add",
        path: `${basePath}/affordances`,
        value: newNode.affordances
      });
    } else if (oldNode.affordances) {
      ops.push({
        op: "remove",
        path: `${basePath}/affordances`
      });
    }
  }
  if (JSON.stringify(oldNode.meta) !== JSON.stringify(newNode.meta)) {
    if (newNode.meta) {
      ops.push({
        op: oldNode.meta ? "replace" : "add",
        path: `${basePath}/meta`,
        value: newNode.meta
      });
    } else if (oldNode.meta) {
      ops.push({
        op: "remove",
        path: `${basePath}/meta`
      });
    }
  }
  if (JSON.stringify(oldNode.content_ref) !== JSON.stringify(newNode.content_ref)) {
    if (newNode.content_ref) {
      ops.push({
        op: oldNode.content_ref ? "replace" : "add",
        path: `${basePath}/content_ref`,
        value: newNode.content_ref
      });
    } else if (oldNode.content_ref) {
      ops.push({
        op: "remove",
        path: `${basePath}/content_ref`
      });
    }
  }
  const oldChildren = oldNode.children ?? [];
  const newChildren = newNode.children ?? [];
  const oldMap = new Map(oldChildren.map((c) => [c.id, c]));
  const newMap = new Map(newChildren.map((c) => [c.id, c]));
  for (const child of oldChildren) {
    if (!newMap.has(child.id)) {
      ops.push({
        op: "remove",
        path: `${basePath}/${child.id}`
      });
    }
  }
  for (const child of newChildren) {
    if (!oldMap.has(child.id)) {
      ops.push({
        op: "add",
        path: `${basePath}/${child.id}`,
        value: child
      });
    }
  }
  for (const child of newChildren) {
    const oldChild = oldMap.get(child.id);
    if (oldChild) {
      ops.push(...diffNodes(oldChild, child, `${basePath}/${child.id}`));
    }
  }
  return ops;
}
function prepareTree(root, options) {
  let tree = root;
  if (options.minSalience != null || options.types != null) {
    tree = filterTree(tree, options.minSalience, options.types);
  }
  if (options.maxDepth != null) {
    tree = truncateTree(tree, options.maxDepth);
  }
  if (options.maxNodes != null) {
    tree = autoCompact(tree, options.maxNodes);
  }
  return tree;
}
function getSubtree(root, path) {
  if (!path || path === "/") return root;
  const segments = path.replace(/^\//, "").split("/").filter(Boolean);
  let current = root;
  for (const seg of segments) {
    const child = current.children?.find((c) => c.id === seg);
    if (!child) return;
    current = child;
  }
  return current;
}
function truncateTree(node, depth) {
  if (depth <= 0 && node.children?.length) {
    return __spreadProps(__spreadValues({
      id: node.id,
      type: node.type
    }, node.properties && {
      properties: node.properties
    }), {
      meta: __spreadProps(__spreadValues({}, node.meta), {
        total_children: node.children.length
      })
    });
  }
  if (!node.children) return node;
  return __spreadProps(__spreadValues({}, node), {
    children: node.children.map((c) => truncateTree(c, depth - 1))
  });
}
function autoCompact(root, maxNodes) {
  const total = countNodes(root);
  if (total <= maxNodes) return root;
  const candidates = [];
  if (root.children) {
    for (let i = 0; i < root.children.length; i++) {
      collectCandidates(root.children[i], [i], candidates, false);
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  const tree = structuredClone(root);
  let nodeCount = total;
  for (const candidate of candidates) {
    if (nodeCount <= maxNodes) break;
    const saved = collapseAtPath(tree, candidate.path);
    nodeCount -= saved;
  }
  return tree;
}
function filterTree(node, minSalience, types) {
  if (!node.children) return node;
  const filtered = node.children.filter((child) => {
    if (minSalience != null) {
      const salience = child.meta?.salience ?? 0.5;
      if (salience < minSalience) return false;
    }
    if (types != null && !types.includes(child.type)) return false;
    return true;
  }).map((child) => filterTree(child, minSalience, types));
  return __spreadProps(__spreadValues({}, node), {
    children: filtered.length > 0 ? filtered : void 0
  });
}
function countNodes(node) {
  return 1 + (node.children?.reduce((sum, c) => sum + countNodes(c), 0) ?? 0);
}
function collectCandidates(node, path, candidates, isRootChild = false) {
  if (!node.children) return;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const childPath = [...path, i];
    if (child.children?.length && !isRootChild && !child.meta?.pinned) {
      const childCount = countNodes(child) - 1;
      const salience = child.meta?.salience ?? 0.5;
      const depth = childPath.length;
      const score = salience - depth * 0.01 - childCount * 1e-3;
      candidates.push({
        path: childPath,
        score,
        childCount
      });
    }
    collectCandidates(child, childPath, candidates, false);
  }
}
function collapseAtPath(tree, path) {
  let node = tree;
  for (let i = 0; i < path.length - 1; i++) {
    if (!node.children?.[path[i]]) return 0;
    node = node.children[path[i]];
  }
  const idx = path[path.length - 1];
  if (!node.children?.[idx]) return 0;
  const target = node.children[idx];
  const saved = countNodes(target) - 1;
  node.children[idx] = __spreadProps(__spreadValues(__spreadValues({
    id: target.id,
    type: target.type
  }, target.properties && {
    properties: target.properties
  }), target.affordances && {
    affordances: target.affordances
  }), {
    meta: __spreadProps(__spreadValues({}, target.meta), {
      total_children: target.children?.length ?? 0,
      summary: target.meta?.summary ?? `${target.children?.length ?? 0} children`
    })
  });
  return saved;
}
var ProviderBase = class {
  options;
  currentTree = {
    id: "root",
    type: "root"
  };
  currentHandlers = /* @__PURE__ */ new Map();
  version = 0;
  constructor(options) {
    this.options = options;
  }
  getVersion() {
    return this.version;
  }
  getTree() {
    return this.currentTree;
  }
  rebuild() {
    const registrations = this.getRegistrations();
    const {
      tree,
      handlers
    } = assembleTree(registrations, this.options.id, this.options.name);
    const ops = diffNodes(this.currentTree, tree);
    this.currentHandlers = handlers;
    if (ops.length > 0) {
      this.currentTree = tree;
      this.version++;
      this.broadcast(ops);
    } else if (this.version === 0) {
      this.currentTree = tree;
      this.version = 1;
    }
  }
  resolveHandler(path, action2) {
    const rootPrefix = `/${this.options.id}/`;
    let cleanPath = path;
    if (cleanPath.startsWith(rootPrefix)) {
      cleanPath = cleanPath.slice(rootPrefix.length);
    } else if (cleanPath.startsWith("/")) {
      cleanPath = cleanPath.slice(1);
    }
    const key = cleanPath ? `${cleanPath}/${action2}` : action2;
    return this.currentHandlers.get(key);
  }
  async executeInvoke(msg) {
    const handler = this.resolveHandler(msg.path, msg.action);
    if (!handler) {
      return {
        type: "result",
        id: msg.id,
        status: "error",
        error: {
          code: "not_found",
          message: `No handler for ${msg.action} at ${msg.path}`
        }
      };
    }
    try {
      const data = await handler(msg.params ?? {});
      const isAsync = data && typeof data === "object" && data.__async === true;
      const _a = data ?? {}, {
        __async
      } = _a, resultData = __objRest(_a, [
        "__async"
      ]);
      const result = {
        type: "result",
        id: msg.id,
        status: isAsync ? "accepted" : "ok"
      };
      if (Object.keys(resultData).length > 0) {
        result.data = resultData;
      }
      this.rebuild();
      return result;
    } catch (err) {
      return {
        type: "result",
        id: msg.id,
        status: "error",
        error: {
          code: err.code ?? "internal",
          message: err.message ?? String(err)
        }
      };
    }
  }
  helloMessage() {
    return {
      type: "hello",
      provider: {
        id: this.options.id,
        name: this.options.name,
        slop_version: "0.1",
        capabilities: ["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"]
      }
    };
  }
  getOutputTree(request) {
    let tree = request?.path ? getSubtree(this.currentTree, request.path) ?? this.currentTree : this.currentTree;
    tree = prepareTree(tree, {
      maxDepth: request?.depth != null && request.depth >= 0 ? request.depth : this.options.maxDepth,
      maxNodes: this.options.maxNodes,
      minSalience: request?.filter?.min_salience,
      types: request?.filter?.types
    });
    if (request?.window && tree.children) {
      const [offset, count] = request.window;
      const totalChildren = tree.children.length;
      const sliced = tree.children.slice(offset, offset + count);
      tree = __spreadProps(__spreadValues({}, tree), {
        children: sliced,
        meta: __spreadProps(__spreadValues({}, tree.meta), {
          window: [offset, count],
          total_children: totalChildren
        })
      });
    }
    return tree;
  }
  snapshotMessage(id, request) {
    return {
      type: "snapshot",
      id,
      version: this.version,
      tree: this.getOutputTree(request)
    };
  }
};
function pick(obj, keys) {
  const result = {};
  for (const key of keys) {
    if (key in obj) result[key] = obj[key];
  }
  return result;
}
function omit(obj, keys) {
  const result = __spreadValues({}, obj);
  for (const key of keys) delete result[key];
  return result;
}
function action(...args) {
  if (typeof args[0] === "function") {
    return __spreadValues({
      handler: args[0]
    }, args[1]);
  }
  const [params, handler, options] = args;
  return __spreadValues({
    params,
    handler
  }, options);
}

// ../../../packages/typescript/client/dist/index.js
var SlopClientImpl = class extends ProviderBase {
  registrations = /* @__PURE__ */ new Map();
  transports;
  subscriptions = /* @__PURE__ */ new Map();
  rebuildQueued = false;
  constructor(options, transport) {
    super(options);
    this.transports = Array.isArray(transport) ? transport : [transport];
  }
  register(path, descriptor) {
    this.registrations.set(path, descriptor);
    this.scheduleRebuild();
  }
  unregister(path, opts) {
    if (opts?.recursive) {
      const prefix = path + "/";
      for (const key of [...this.registrations.keys()]) {
        if (key === path || key.startsWith(prefix)) {
          this.registrations.delete(key);
        }
      }
    } else {
      this.registrations.delete(path);
    }
    this.scheduleRebuild();
  }
  scope(path, descriptor) {
    if (descriptor) {
      this.register(path, descriptor);
    }
    return createScopedClient(this, path);
  }
  flush() {
    if (this.rebuildQueued) {
      this.rebuildQueued = false;
      this.rebuild();
    }
  }
  asyncAction(params, fn, options) {
    return {
      estimate: "async",
      params,
      label: options?.label,
      description: options?.description,
      handler: (rawParams) => {
        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const abortController = new AbortController();
        const task = {
          id: taskId,
          signal: abortController.signal,
          update: (progress, message) => {
            this.register(`tasks/${taskId}`, __spreadValues({
              type: "status",
              props: {
                progress,
                message,
                status: "running",
                action: options?.label ?? "task"
              },
              meta: {
                salience: 0.8
              }
            }, options?.cancelable && {
              actions: {
                cancel: {
                  dangerous: true,
                  handler: () => {
                    abortController.abort();
                    this.register(`tasks/${taskId}`, {
                      type: "status",
                      props: {
                        status: "cancelled",
                        message: "Cancelled"
                      },
                      meta: {
                        salience: 0.3
                      }
                    });
                    setTimeout(() => this.unregister(`tasks/${taskId}`), 1e4);
                  }
                }
              }
            }));
          }
        };
        task.update(0, options?.label ? `${options.label}...` : "Starting...");
        fn(rawParams, task).then((result) => {
          this.register(`tasks/${taskId}`, {
            type: "status",
            props: {
              progress: 1,
              message: "Complete",
              status: "done",
              result
            },
            meta: {
              salience: 0.5
            }
          });
          setTimeout(() => this.unregister(`tasks/${taskId}`), 3e4);
        }).catch((err) => {
          this.register(`tasks/${taskId}`, {
            type: "status",
            props: {
              progress: 0,
              message: err.message ?? String(err),
              status: "failed"
            },
            meta: {
              salience: 1,
              urgency: "high"
            }
          });
        });
        return {
          __async: true,
          taskId
        };
      }
    };
  }
  start() {
    for (const t of this.transports) {
      t.start();
      t.onMessage((msg) => this.handleMessage(msg, t));
    }
  }
  stop() {
    for (const t of this.transports) t.stop();
  }
  getRegistrations() {
    return this.registrations;
  }
  broadcast(_globalOps) {
    const version = this.getVersion();
    for (const [, sub] of this.subscriptions) {
      const newTree = this.getOutputTree({
        path: sub.path,
        depth: sub.depth,
        filter: sub.filter
      });
      if (!sub.lastTree) {
        sub.lastTree = JSON.parse(JSON.stringify(newTree));
        sub.transport.send({
          type: "snapshot",
          id: sub.id,
          version,
          tree: newTree
        });
        continue;
      }
      const ops = diffNodes(sub.lastTree, newTree);
      sub.lastTree = JSON.parse(JSON.stringify(newTree));
      if (ops.length > 0) {
        sub.transport.send({
          type: "patch",
          subscription: sub.id,
          version,
          ops
        });
      }
    }
  }
  scheduleRebuild() {
    if (this.rebuildQueued) return;
    this.rebuildQueued = true;
    queueMicrotask(() => {
      if (!this.rebuildQueued) return;
      this.rebuildQueued = false;
      this.rebuild();
    });
  }
  handleMessage(msg, transport) {
    switch (msg.type) {
      case "connect":
        transport.send(this.helloMessage());
        break;
      case "subscribe": {
        const outputTree = this.getOutputTree({
          path: msg.path ?? "/",
          depth: msg.depth ?? -1,
          filter: msg.filter
        });
        this.subscriptions.set(msg.id, {
          id: msg.id,
          path: msg.path ?? "/",
          depth: msg.depth ?? -1,
          filter: msg.filter,
          lastTree: JSON.parse(JSON.stringify(outputTree)),
          transport
        });
        transport.send({
          type: "snapshot",
          id: msg.id,
          version: this.getVersion(),
          tree: outputTree
        });
        break;
      }
      case "unsubscribe":
        this.subscriptions.delete(msg.id);
        break;
      case "query":
        transport.send(this.snapshotMessage(msg.id, {
          path: msg.path,
          depth: msg.depth,
          filter: msg.filter
        }));
        break;
      case "invoke":
        this.handleInvoke(msg, transport);
        break;
    }
  }
  async handleInvoke(msg, transport) {
    const result = await this.executeInvoke(msg);
    transport.send(result);
  }
};
function createScopedClient(parent, prefix) {
  return {
    register(path, descriptor) {
      parent.register(`${prefix}/${path}`, descriptor);
    },
    unregister(path, opts) {
      parent.unregister(`${prefix}/${path}`, opts);
    },
    scope(path, descriptor) {
      return parent.scope(`${prefix}/${path}`, descriptor);
    },
    flush() {
      parent.flush();
    },
    asyncAction: parent.asyncAction.bind(parent),
    stop() {
    }
  };
}
function createPostMessageTransport(options = {}) {
  const messageHandlers = [];
  let listener = null;
  let metaTag = null;
  return {
    send(message) {
      window.postMessage(JSON.parse(JSON.stringify({
        slop: true,
        message
      })), "*");
    },
    onMessage(handler) {
      messageHandlers.push(handler);
    },
    start() {
      listener = (event) => {
        if (event.source !== window) return;
        if (event.data?.slop !== true) return;
        const msg = event.data.message;
        if (!msg?.type) return;
        for (const h of messageHandlers) h(msg);
      };
      window.addEventListener("message", listener);
      if (options.discover !== false && typeof document !== "undefined" && !document.querySelector('meta[name="slop"][content="postmessage"]')) {
        metaTag = document.createElement("meta");
        metaTag.name = "slop";
        metaTag.content = "postmessage";
        document.head.appendChild(metaTag);
      }
    },
    stop() {
      if (listener) {
        window.removeEventListener("message", listener);
        listener = null;
      }
      if (metaTag) {
        metaTag.remove();
        metaTag = null;
      }
    }
  };
}
var DEFAULT_DESKTOP_URL = "ws://localhost:9339/slop";
function createWebSocketTransport(url = DEFAULT_DESKTOP_URL, options = {}) {
  const messageHandlers = [];
  let ws = null;
  let stopped = false;
  let reconnectDelay = 1e3;
  let reconnectTimer = null;
  let metaTag = null;
  function connect() {
    if (stopped) return;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      reconnectDelay = 1e3;
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg?.type) {
          for (const h of messageHandlers) h(msg);
        }
      } catch {
      }
    };
    ws.onclose = () => {
      ws = null;
      scheduleReconnect();
    };
    ws.onerror = () => {
    };
  }
  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 3e4);
  }
  return {
    send(message) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    },
    onMessage(handler) {
      messageHandlers.push(handler);
    },
    start() {
      stopped = false;
      connect();
      if (options.discover !== false && typeof document !== "undefined") {
        const selector = `meta[name="slop"][content="${url}"]`;
        if (!document.querySelector(selector)) {
          metaTag = document.createElement("meta");
          metaTag.name = "slop";
          metaTag.content = url;
          document.head.appendChild(metaTag);
        }
      }
    },
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
      if (metaTag) {
        metaTag.remove();
        metaTag = null;
      }
    }
  };
}
function createSlop(options) {
  const transports = [];
  const enabledTransports = options.transports ?? ["postmessage", ...options.websocketUrl ?? options.desktopUrl ? ["websocket"] : []];
  const websocketUrl = options.websocketUrl ?? options.desktopUrl;
  if (enabledTransports.includes("postmessage")) {
    transports.push(createPostMessageTransport({
      discover: options.postmessageDiscover
    }));
  }
  if (enabledTransports.includes("websocket")) {
    const url = typeof websocketUrl === "string" ? websocketUrl : void 0;
    transports.push(createWebSocketTransport(url, {
      discover: options.websocketDiscover
    }));
  }
  const client = new SlopClientImpl(options, transports);
  client.start();
  return client;
}
export {
  ProviderBase,
  SlopClientImpl,
  action,
  assembleTree,
  autoCompact,
  countNodes,
  createPostMessageTransport,
  createSlop,
  createWebSocketTransport,
  diffNodes,
  filterTree,
  getSubtree,
  omit,
  pick,
  prepareTree,
  truncateTree
};
//# sourceMappingURL=@slop-ai_client.js.map
