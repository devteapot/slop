import type {
  SlopNode,
  PatchOp,
  NodeDescriptor,
  JsonSchema,
  ParamDef,
} from "@slop-ai/core";
import type { Connection, SlopServer } from "@slop-ai/server";

const NODE_FIELDS = new Set(["properties", "meta", "affordances", "content_ref"]);

interface PendingInvoke {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

let sessionCounter = 0;

export class UiMountSession {
  readonly id = `ui-session-${++sessionCounter}`;

  private remoteTree: SlopNode | null = null;
  private remoteRootId = "ui";
  private readonly subscriptionId = `${this.id}-sub`;
  private requestCounter = 0;
  private mounted = false;
  private active = true;
  private pendingInvokes = new Map<string, PendingInvoke>();

  constructor(
    private readonly slop: SlopServer,
    private readonly connection: Connection,
    private readonly mountPath: string,
  ) {}

  start(): void {
    this.connection.send({ type: "connect" });
  }

  handleMessage(message: any): void {
    if (!this.active || !message?.type) return;

    switch (message.type) {
      case "hello":
        this.remoteRootId = message.provider?.id ?? this.remoteRootId;
        this.connection.send({
          type: "subscribe",
          id: this.subscriptionId,
          path: "/",
          depth: -1,
        });
        break;

      case "snapshot":
        if (message.id === this.subscriptionId) {
          this.applySnapshot(message.tree);
        } else {
          this.resolvePendingResult(message.id, message.tree);
        }
        break;

      case "patch":
        if (message.subscription === this.subscriptionId) {
          this.applyPatch(message.ops ?? []);
        }
        break;

      case "result":
        try {
          this.resolvePendingResult(message.id, normalizeInvokeResult(message));
        } catch (error) {
          this.rejectPendingResult(message.id, error);
        }
        break;

      case "error":
        this.rejectPendingResult(
          message.id,
          new Error(message.error?.message ?? "Remote UI invoke failed"),
        );
        break;

      case "batch":
        for (const inner of message.messages ?? []) {
          this.handleMessage(inner);
        }
        break;
    }
  }

  deactivate(reason = "UI session replaced"): void {
    if (!this.active) return;
    this.active = false;

    if (this.mounted) {
      this.slop.unregister(this.mountPath);
      this.mounted = false;
    }

    try {
      this.connection.send({ type: "unsubscribe", id: this.subscriptionId });
    } catch {}

    const error = new Error(reason);
    for (const pending of this.pendingInvokes.values()) {
      pending.reject(error);
    }
    this.pendingInvokes.clear();
  }

  private applySnapshot(tree: SlopNode): void {
    this.remoteTree = structuredClone(tree);
    this.remoteRootId = tree.id || this.remoteRootId;

    if (!this.mounted) {
      this.slop.register(this.mountPath, () => this.buildDescriptor());
      this.mounted = true;
      return;
    }

    this.slop.refresh();
  }

  private applyPatch(ops: PatchOp[]): void {
    if (!this.remoteTree) return;
    applyPatchOps(this.remoteTree, ops);
    this.slop.refresh();
  }

  private buildDescriptor(): NodeDescriptor {
    if (!this.remoteTree) {
      return { type: "group" };
    }

    return nodeToDescriptor(
      this.remoteTree,
      `/${this.remoteRootId}`,
      (path, action, params) => this.invokeRemote(path, action, params),
      true,
    );
  }

  private invokeRemote(
    path: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.active) {
      return Promise.reject(new Error("Remote UI session is no longer active"));
    }

    const id = `${this.id}-invoke-${++this.requestCounter}`;
    return new Promise((resolve, reject) => {
      this.pendingInvokes.set(id, { resolve, reject });
      this.connection.send({
        type: "invoke",
        id,
        path,
        action,
        params,
      });
    });
  }

  private resolvePendingResult(id: string | undefined, value: unknown): void {
    if (!id) return;
    const pending = this.pendingInvokes.get(id);
    if (!pending) return;
    this.pendingInvokes.delete(id);
    pending.resolve(value);
  }

  private rejectPendingResult(id: string | undefined, error: unknown): void {
    if (!id) return;
    const pending = this.pendingInvokes.get(id);
    if (!pending) return;
    this.pendingInvokes.delete(id);
    pending.reject(error);
  }
}

function normalizeInvokeResult(message: any): unknown {
  if (message.status === "accepted") {
    return { __async: true, ...(message.data ?? {}) };
  }

  if (message.status === "error") {
    throw new Error(message.error?.message ?? "Remote UI invoke failed");
  }

  return message.data;
}

function nodeToDescriptor(
  node: SlopNode,
  remotePath: string,
  invoke: (path: string, action: string, params: Record<string, unknown>) => Promise<unknown>,
  isMountedRoot = false,
): NodeDescriptor {
  const descriptor: NodeDescriptor = {
    type: isMountedRoot && node.type === "root" ? "group" : node.type,
  };

  if (node.properties) {
    descriptor.props = structuredClone(node.properties);
  }

  if (node.meta) {
    descriptor.meta = structuredClone(node.meta);
  }

  if (node.content_ref) {
    descriptor.contentRef = structuredClone(node.content_ref);
  }

  if (node.affordances?.length) {
    descriptor.actions = Object.fromEntries(
      node.affordances.map((affordance) => [
        affordance.action,
        {
          ...(affordance.label ? { label: affordance.label } : {}),
          ...(affordance.description ? { description: affordance.description } : {}),
          ...(affordance.dangerous ? { dangerous: true } : {}),
          ...(affordance.idempotent ? { idempotent: true } : {}),
          ...(affordance.estimate ? { estimate: affordance.estimate } : {}),
          ...(affordance.params
            ? { params: schemaToParamDefs(affordance.params) }
            : {}),
          handler: (params: Record<string, unknown>) =>
            invoke(remotePath, affordance.action, params),
        },
      ]),
    );
  }

  if (node.children?.length) {
    descriptor.children = Object.fromEntries(
      node.children.map((child) => [
        child.id,
        nodeToDescriptor(child, `${remotePath}/${child.id}`, invoke),
      ]),
    );
  }

  return descriptor;
}

function schemaToParamDefs(schema: JsonSchema): Record<string, ParamDef> {
  if (schema.type !== "object" || !schema.properties) {
    return {};
  }

  const params: Record<string, ParamDef> = {};
  for (const [key, value] of Object.entries(schema.properties)) {
    params[key] = {
      type: value.type,
      ...(value.description ? { description: value.description } : {}),
      ...(value.enum ? { enum: value.enum } : {}),
    };
  }
  return params;
}

function applyPatchOps(root: SlopNode, ops: PatchOp[]): void {
  for (const op of ops) {
    const segments = op.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    switch (op.op) {
      case "add":
        applyAdd(root, segments, op.value);
        break;
      case "remove":
        applyRemove(root, segments);
        break;
      case "replace":
        applyReplace(root, segments, op.value);
        break;
    }
  }
}

function applyAdd(root: SlopNode, segments: string[], value: unknown): void {
  if (!isFieldSegment(segments)) {
    const parent = resolveNode(root, segments.slice(0, -1));
    if (!parent) return;
    if (!parent.children) parent.children = [];
    parent.children.push(value as SlopNode);
    return;
  }

  const target = navigate(root, segments);
  if (target) target.parent[target.key] = value;
}

function applyRemove(root: SlopNode, segments: string[]): void {
  if (!isFieldSegment(segments)) {
    const parent = resolveNode(root, segments.slice(0, -1));
    const childId = segments[segments.length - 1];
    if (!parent?.children) return;
    parent.children = parent.children.filter((child) => child.id !== childId);
    return;
  }

  const target = navigate(root, segments);
  if (target) {
    delete target.parent[target.key];
  }
}

function applyReplace(root: SlopNode, segments: string[], value: unknown): void {
  const target = navigate(root, segments);
  if (target) {
    target.parent[target.key] = value;
  }
}

function navigate(
  root: SlopNode,
  segments: string[],
): { parent: any; key: string } | null {
  let current: any = root;
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index];
    if (NODE_FIELDS.has(segment)) {
      current = current[segment];
      if (current === undefined) return null;
      continue;
    }

    const child = (current.children as SlopNode[] | undefined)?.find(
      (candidate) => candidate.id === segment,
    );
    if (!child) return null;
    current = child;
  }

  return { parent: current, key: segments[segments.length - 1] };
}

function isFieldSegment(segments: string[]): boolean {
  if (segments.length === 1) {
    return NODE_FIELDS.has(segments[0]);
  }

  for (let index = segments.length - 2; index >= 0; index--) {
    if (NODE_FIELDS.has(segments[index])) {
      return true;
    }
  }

  return false;
}

function resolveNode(root: SlopNode, segments: string[]): SlopNode | null {
  if (segments.length === 0) {
    return root;
  }

  let current: SlopNode = root;
  for (const segment of segments) {
    if (NODE_FIELDS.has(segment)) continue;
    const child = current.children?.find((candidate) => candidate.id === segment);
    if (!child) return null;
    current = child;
  }

  return current;
}
