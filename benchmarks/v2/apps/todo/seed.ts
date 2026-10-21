import type { DataScale } from "../../runner/types.ts";
import type { Priority, Task } from "./store.ts";

const PRIORITIES: Priority[] = ["low", "medium", "high"];
const TAGS = ["bug", "meeting", "errand", "read", "chore", "work", "personal"];
const TITLES = [
  "Fix login redirect loop",
  "Review sprint metrics",
  "Pick up groceries",
  "Read new pricing RFC",
  "Update quarterly OKRs",
  "Call dentist",
  "Refactor data loader",
  "Write postmortem",
  "Prep 1:1 agenda",
  "Cancel old subscription",
];

const SIZES: Record<DataScale, number> = { s: 8, m: 30, l: 100, xl: 500 };
const BUG_SHARE = 0.2; // ~20% of tasks tagged as bug
const DONE_SHARE = 0.25;

/**
 * Deterministic seeded PRNG — xorshift32. Two runs with the same (scale, seed)
 * produce byte-identical tasks. This is what lets the sweep reproduce cells.
 */
function makeRng(seed: number) {
  let x = seed || 0x1234567;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1_000_000) / 1_000_000;
  };
}

export function seedTodo(scale: DataScale, seed: number): Task[] {
  const rng = makeRng(seed);
  const count = SIZES[scale];
  const out: Task[] = [];
  for (let i = 0; i < count; i++) {
    const title = `${TITLES[i % TITLES.length]} #${i + 1}`;
    const isBug = rng() < BUG_SHARE;
    // Non-bug tasks are capped at medium so `prioritize-bugs` can check
    // "no non-bug is high" without needing a pre-state snapshot. Bugs start
    // at anything and the agent is asked to raise them to high.
    const otherTags = TAGS.filter((t) => t !== "bug");
    const tag = isBug ? "bug" : rng() < 0.7 ? otherTags[Math.floor(rng() * otherTags.length)] : null;
    const pri = isBug
      ? PRIORITIES[Math.floor(rng() * PRIORITIES.length)]
      : (["low", "medium"] as Priority[])[Math.floor(rng() * 2)];
    const done = rng() < DONE_SHARE;
    out.push({
      id: `task-${i + 1}`,
      title,
      priority: pri,
      tag,
      done,
      createdAt: 1_700_000_000_000 + i * 1000,
    });
  }
  return out;
}
