import { describe, test, expect } from "bun:test";
import { normalizeDescriptor } from "../src/descriptor";

describe("normalizeDescriptor", () => {
  test("converts props to properties", () => {
    const { node } = normalizeDescriptor("notes", "notes", {
      type: "collection",
      props: { count: 3, label: "Notes" },
    });
    expect(node.properties).toEqual({ count: 3, label: "Notes" });
  });

  test("converts bare function action to affordance + handler", () => {
    const fn = () => {};
    const { node, handlers } = normalizeDescriptor("notes", "notes", {
      type: "collection",
      actions: { create: fn },
    });
    expect(node.affordances).toEqual([{ action: "create" }]);
    expect(handlers.get("notes/create")).toBe(fn);
  });

  test("converts ActionDescriptor with params and dangerous", () => {
    const fn = () => {};
    const { node, handlers } = normalizeDescriptor("notes", "notes", {
      type: "collection",
      actions: {
        delete: {
          handler: fn,
          label: "Delete All",
          dangerous: true,
          params: { confirm: "boolean" },
        },
      },
    });
    expect(node.affordances).toEqual([{
      action: "delete",
      label: "Delete All",
      dangerous: true,
      params: {
        type: "object",
        properties: { confirm: { type: "boolean" } },
        required: ["confirm"],
      },
    }]);
    expect(handlers.get("notes/delete")).toBe(fn);
  });

  test("converts items to children with type 'item'", () => {
    const toggleFn = () => {};
    const { node, handlers } = normalizeDescriptor("notes", "notes", {
      type: "collection",
      items: [
        {
          id: "n1",
          props: { title: "Hello" },
          actions: { toggle: toggleFn },
        },
        {
          id: "n2",
          props: { title: "World" },
        },
      ],
    });
    expect(node.children).toHaveLength(2);
    expect(node.children![0].id).toBe("n1");
    expect(node.children![0].type).toBe("item");
    expect(node.children![0].properties).toEqual({ title: "Hello" });
    expect(node.children![0].affordances).toEqual([{ action: "toggle" }]);
    expect(node.children![1].id).toBe("n2");
    expect(handlers.get("notes/n1/toggle")).toBe(toggleFn);
  });

  test("converts inline children recursively", () => {
    const { node } = normalizeDescriptor("settings", "settings", {
      type: "view",
      children: {
        account: {
          type: "group",
          props: { email: "test@example.com" },
        },
        notifications: {
          type: "group",
          props: { enabled: true },
        },
      },
    });
    expect(node.children).toHaveLength(2);
    expect(node.children![0].id).toBe("account");
    expect(node.children![0].type).toBe("group");
    expect(node.children![0].properties).toEqual({ email: "test@example.com" });
    expect(node.children![1].id).toBe("notifications");
  });

  test("preserves meta", () => {
    const { node } = normalizeDescriptor("alert", "alert", {
      type: "status",
      meta: { salience: 1.0, urgency: "critical" },
    });
    expect(node.meta).toEqual({ salience: 1.0, urgency: "critical" });
  });

  test("handles empty descriptor", () => {
    const { node, handlers } = normalizeDescriptor("empty", "empty", {
      type: "group",
    });
    expect(node.id).toBe("empty");
    expect(node.type).toBe("group");
    expect(node.children).toBeUndefined();
    expect(node.affordances).toBeUndefined();
    expect(handlers.size).toBe(0);
  });

  test("nested item children get correct handler paths", () => {
    const editFn = () => {};
    const { handlers } = normalizeDescriptor("inbox/messages", "messages", {
      type: "collection",
      items: [{
        id: "msg-1",
        props: { subject: "Hi" },
        actions: { edit: editFn },
      }],
    });
    expect(handlers.get("inbox/messages/msg-1/edit")).toBe(editFn);
  });

  test("summary maps to meta.summary", () => {
    const { node } = normalizeDescriptor("inbox", "inbox", {
      type: "view",
      summary: "142 messages, 12 unread",
    });
    expect(node.meta?.summary).toBe("142 messages, 12 unread");
  });

  test("summary merges with existing meta", () => {
    const { node } = normalizeDescriptor("inbox", "inbox", {
      type: "view",
      summary: "142 messages",
      meta: { salience: 0.8 },
    });
    expect(node.meta?.summary).toBe("142 messages");
    expect(node.meta?.salience).toBe(0.8);
  });

  test("window creates children with total_children and window meta", () => {
    const { node } = normalizeDescriptor("messages", "messages", {
      type: "collection",
      window: {
        items: [
          { id: "m1", props: { title: "First" } },
          { id: "m2", props: { title: "Second" } },
        ],
        total: 500,
        offset: 10,
      },
    });
    expect(node.children).toHaveLength(2);
    expect(node.children![0].id).toBe("m1");
    expect(node.meta?.total_children).toBe(500);
    expect(node.meta?.window).toEqual([10, 2]);
  });

  test("contentRef maps to top-level content_ref field", () => {
    const { node } = normalizeDescriptor("doc", "doc", {
      type: "document",
      props: { title: "main.ts" },
      contentRef: {
        type: "text",
        mime: "text/typescript",
        size: 12400,
        summary: "TypeScript module",
        preview: "import { createSlop }...",
      },
    });
    expect(node.properties?.title).toBe("main.ts");
    expect(node.properties?.content_ref).toBeUndefined();
    expect(node.content_ref).toBeDefined();
    expect(node.content_ref!.type).toBe("text");
    expect(node.content_ref!.mime).toBe("text/typescript");
    expect(node.content_ref!.summary).toBe("TypeScript module");
    expect(node.content_ref!.uri).toBe("slop://content/doc");
  });

  test("contentRef uses explicit uri when provided", () => {
    const { node } = normalizeDescriptor("img", "img", {
      type: "document",
      contentRef: {
        type: "binary",
        mime: "image/png",
        summary: "Photo",
        uri: "https://cdn.example.com/photo.png",
      },
    });
    expect(node.content_ref!.uri).toBe("https://cdn.example.com/photo.png");
  });

  test("item summary maps to meta.summary", () => {
    const { node } = normalizeDescriptor("notes", "notes", {
      type: "collection",
      items: [{
        id: "n1",
        props: { title: "Note" },
        summary: "A short note about testing",
      }],
    });
    expect(node.children![0].meta?.summary).toBe("A short note about testing");
  });
});
