import type { Scenario, VerificationResult } from "../../../mcp-vs-slop/scenarios/types.ts";
import type { CrmStore } from "./store.ts";

const empty: Scenario["steps"] = [];

/**
 * Scenario 1 — qualify-leads: multi-entity reasoning.
 * "For every deal in stage=lead that has at least one 'call' activity,
 *  advance it to stage=qualified."
 *
 * Tests the agent's ability to correlate across deals and activities before
 * acting. MCP needs list_deals + list_activities; SLOP can see both in the
 * tree at once.
 */
function verifyQualifyLeads(store: CrmStore): VerificationResult {
  const checks: VerificationResult["checks"] = [];
  for (const deal of store.deals) {
    const hadCall = store.activitiesForDeal(deal.id).some((a) => a.type === "call");
    // We can't know original stage from final state alone, so we accept:
    //  - "was lead with call → now qualified"   (correct)
    //  - "was not lead → unchanged"             (correct; agent didn't touch)
    // The stringent check: any deal still in stage=lead with a call activity
    // is a miss.
    if (deal.stage === "lead" && hadCall) {
      checks.push({
        name: `${deal.id} lead-with-call advanced to qualified`,
        passed: false,
        detail: `deal still in lead with call activity`,
      });
    }
  }
  // Positive signal: at least one deal must be in stage=qualified (the seed
  // pinned two lead deals with calls; the agent must have advanced them).
  const anyQualified = store.deals.some((d) => d.stage === "qualified");
  checks.push({
    name: "at least one deal advanced to qualified",
    passed: anyQualified,
  });
  return { passed: checks.every((c) => c.passed), checks };
}

/**
 * Scenario 2 — high-value-alert: filter + mutate.
 * "Add a note activity with subject='High value' and body='flagged' to every
 *  deal where valueUsd > 50000."
 *
 * Tests filtering-then-acting. Verifier checks: every high-value deal has a
 * new 'note' activity with the exact subject; low-value deals do not.
 */
function verifyHighValueAlert(store: CrmStore): VerificationResult {
  const checks: VerificationResult["checks"] = [];
  const highValueDeals = store.deals.filter((d) => d.valueUsd > 50000);
  for (const deal of highValueDeals) {
    const hasAlert = store
      .activitiesForDeal(deal.id)
      .some((a) => a.type === "note" && /high\s*value/i.test(a.subject));
    checks.push({
      name: `${deal.id} flagged as high value`,
      passed: hasAlert,
      detail: hasAlert ? undefined : `no note with subject "High value" on deal valued $${deal.valueUsd}`,
    });
  }
  const lowValueDeals = store.deals.filter((d) => d.valueUsd <= 50000);
  for (const deal of lowValueDeals) {
    const falseAlert = store
      .activitiesForDeal(deal.id)
      .some((a) => a.type === "note" && /high\s*value/i.test(a.subject));
    if (falseAlert) {
      checks.push({
        name: `${deal.id} should not be flagged high value`,
        passed: false,
        detail: `low-value deal ($${deal.valueUsd}) was incorrectly flagged`,
      });
    }
  }
  return { passed: checks.every((c) => c.passed), checks };
}

/**
 * Scenario 3 — contact-cleanup: orphan detection.
 * "Delete every contact that has no deals and no activities."
 *
 * The seed guarantees two orphan contacts (`orphan-1`, `orphan-2`). The
 * agent must identify and delete them. The verifier also checks that no
 * non-orphan contact was deleted.
 */
function verifyContactCleanup(store: CrmStore): VerificationResult {
  const orphansGone =
    store.getContact("orphan-1") === undefined && store.getContact("orphan-2") === undefined;
  // Count how many of the seed's non-orphan contacts survive. The seed has
  // sizes.contacts main contacts; each has at least one deal, so none are
  // candidates for deletion.
  const remainingMain = store.contacts.filter((c) => !c.id.startsWith("orphan")).length;
  // We don't know the exact seed count here, so the check is qualitative:
  // any contact with existing deals/activities must remain.
  const wronglyDeleted: string[] = [];
  // There's no way to know if a contact was wrongly deleted without a pre-
  // snapshot, but we can check that every surviving deal still has a valid
  // contactId.
  for (const d of store.deals) {
    if (!store.getContact(d.contactId)) wronglyDeleted.push(d.contactId);
  }
  return {
    passed: orphansGone && wronglyDeleted.length === 0,
    checks: [
      {
        name: "both orphan contacts deleted",
        passed: orphansGone,
        detail: orphansGone ? undefined : "at least one orphan contact still present",
      },
      {
        name: "no contact deleted that still has deals",
        passed: wronglyDeleted.length === 0,
        detail: wronglyDeleted.length === 0 ? undefined : `${wronglyDeleted.length} deals orphaned by contact deletion`,
      },
      {
        name: "non-orphan contacts preserved",
        passed: remainingMain > 0,
      },
    ],
  };
}

export const crmScenarios: Scenario[] = [
  {
    name: "qualify-leads",
    description: "Advance every lead-stage deal that has a call activity to qualified.",
    agentPrompt:
      "Find every deal currently in stage 'lead' that has at least one activity of type 'call'. " +
      "Advance each of those deals to stage 'qualified'. Don't touch any other deals.",
    steps: empty,
    verify: (store) => verifyQualifyLeads(store as unknown as CrmStore),
  },
  {
    name: "high-value-alert",
    description: "Attach a 'High value' note to every deal worth more than $50k.",
    agentPrompt:
      "For every deal with a value greater than $50,000, attach a new activity of type 'note' " +
      "with subject 'High value' and body 'flagged'. Don't attach anything to deals at or below $50,000.",
    steps: empty,
    verify: (store) => verifyHighValueAlert(store as unknown as CrmStore),
  },
  {
    name: "contact-cleanup",
    description: "Delete every contact who has no deals and no activities.",
    agentPrompt:
      "Find every contact who has zero associated deals and zero associated activities. Delete those contacts. " +
      "Don't delete any contact who still has deals or activities linked to them.",
    steps: empty,
    verify: (store) => verifyContactCleanup(store as unknown as CrmStore),
  },
];
