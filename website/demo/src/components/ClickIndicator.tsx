import { useEffect, useState } from "react";
import { useDemo } from "../context";

export function ClickIndicator() {
  const { clickTarget } = useDemo();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!clickTarget) {
      setVisible(false);
      return;
    }

    const el = document.querySelector(`[data-click-target="${clickTarget}"]`);
    if (!el) {
      setVisible(false);
      return;
    }

    const rect = el.getBoundingClientRect();
    setPos({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    setVisible(true);

    // Also add highlight class to the element
    el.classList.add("click-target-highlight");
    return () => {
      el.classList.remove("click-target-highlight");
    };
  }, [clickTarget]);

  if (!visible || !pos) return null;

  return (
    <div
      className="fixed pointer-events-none z-50"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Cursor dot */}
      <div className="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-secondary border-2 border-on-surface shadow-lg shadow-secondary/30" />
      {/* Ripple */}
      <div className="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-secondary click-ripple" />
    </div>
  );
}
