"use client";

import { useState, useEffect, useCallback } from "react";

interface Todo {
  id: string;
  title: string;
  done: boolean;
}

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTitle, setNewTitle] = useState("");

  const load = useCallback(() => {
    fetch("/api/todos")
      .then((r) => r.json())
      .then(setTodos);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!newTitle.trim()) return;
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    });
    setNewTitle("");
    load();
  };

  const toggle = async (id: string) => {
    await fetch(`/api/todos?id=${id}`, { method: "PATCH" });
    load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/todos?id=${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "40px 20px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Todos</h1>
      <p style={{ color: "#8b949e", marginBottom: 24 }}>
        Next.js + SLOP (WebSocket)
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a todo..."
          style={{
            flex: 1,
            padding: "10px 14px",
            background: "#1c2028",
            border: "1px solid #30363d",
            borderRadius: 6,
            color: "#e1e4e8",
            fontSize: 14,
            outline: "none",
          }}
        />
        <button
          onClick={add}
          style={{
            padding: "10px 20px",
            background: "#238636",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Add
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {todos.map((t) => (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 16px",
              background: "#161b22",
              borderRadius: 8,
              border: "1px solid #21262d",
            }}
          >
            <input
              type="checkbox"
              checked={t.done}
              onChange={() => toggle(t.id)}
              style={{ width: 18, height: 18, accentColor: "#238636" }}
            />
            <span
              style={{
                flex: 1,
                textDecoration: t.done ? "line-through" : "none",
                color: t.done ? "#484f58" : "#e1e4e8",
              }}
            >
              {t.title}
            </span>
            <button
              onClick={() => remove(t.id)}
              style={{
                background: "none",
                border: "none",
                color: "#da3633",
                cursor: "pointer",
                fontSize: 18,
                padding: 4,
              }}
            >
              x
            </button>
          </div>
        ))}
      </div>

      {todos.length === 0 && (
        <p style={{ color: "#484f58", textAlign: "center", padding: 40 }}>
          No todos yet. Add one above!
        </p>
      )}

      <p
        style={{
          color: "#30363d",
          fontSize: 12,
          marginTop: 40,
          textAlign: "center",
        }}
      >
        {todos.filter((t) => t.done).length}/{todos.length} done - SLOP
        WebSocket at /api/slop
      </p>
    </div>
  );
}
