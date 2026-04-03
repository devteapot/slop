import type { Card } from "./types";

export interface SalienceResult {
  salience: number;
  urgency: "none" | "low" | "medium" | "high" | "critical";
  reason: string;
  pinned: boolean;
}

export function computeSalience(card: Card): SalienceResult {
  if (card.column === "done") {
    return { salience: 0.2, urgency: "none", reason: "completed", pinned: false };
  }

  const isCritical = card.priority === "critical";
  const isHigh = card.priority === "high";
  const isMedium = card.priority === "medium";

  const daysUntilDue = card.due ? getDaysUntilDue(card.due) : null;
  const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
  const isDueSoon2 = daysUntilDue !== null && daysUntilDue <= 2;
  const isDueSoon3 = daysUntilDue !== null && daysUntilDue <= 3;

  let salience: number;
  let urgency: SalienceResult["urgency"];
  let reason: string;

  if (isCritical && isDueSoon2) {
    salience = 1.0;
    urgency = "critical";
    reason = daysUntilDue === 0 ? "critical priority, due today"
      : daysUntilDue === 1 ? "critical priority, due tomorrow"
      : isOverdue ? `critical priority, overdue by ${Math.abs(daysUntilDue!)} days`
      : `critical priority, due in ${daysUntilDue} days`;
  } else if (isCritical) {
    salience = 0.9;
    urgency = "high";
    reason = card.due ? `critical priority, due ${formatDueDistance(daysUntilDue!)}` : "critical priority";
  } else if (isHigh && isDueSoon3) {
    salience = 0.8;
    urgency = "medium";
    reason = `high priority, due ${formatDueDistance(daysUntilDue!)}`;
  } else if (isHigh) {
    salience = 0.7;
    urgency = "low";
    reason = card.due ? `high priority, due ${formatDueDistance(daysUntilDue!)}` : "high priority";
  } else if (isMedium && isDueSoon3) {
    salience = 0.6;
    urgency = "medium";
    reason = `medium priority, due ${formatDueDistance(daysUntilDue!)}`;
  } else if (isMedium) {
    salience = 0.5;
    urgency = "none";
    reason = card.due ? `medium priority, due ${formatDueDistance(daysUntilDue!)}` : "medium priority";
  } else {
    salience = 0.3;
    urgency = "none";
    reason = card.due ? `low priority, due ${formatDueDistance(daysUntilDue!)}` : "low priority";
  }

  if (isOverdue && !isCritical) {
    salience = Math.min(salience + 0.1, 1.0);
    if (urgency === "none") urgency = "low";
    else if (urgency === "low") urgency = "medium";
    else if (urgency === "medium") urgency = "high";
    reason = reason.replace(/due /, "overdue, was due ");
  }

  return {
    salience,
    urgency,
    reason,
    pinned: isCritical,
  };
}

function getDaysUntilDue(due: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dueDate = new Date(due);
  dueDate.setHours(0, 0, 0, 0);
  return Math.round((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDueDistance(days: number): string {
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
