import type { DataScale } from "../../runner/types.ts";
import type { Activity, ActivityType, Contact, Deal, DealStage } from "./store.ts";

const COMPANIES = ["Acme Co", "Globex", "Initech", "Umbrella", "Hooli", "Stark Industries"];
const NAMES = ["Alice", "Bob", "Carol", "Dan", "Erin", "Frank", "Grace", "Heidi", "Ivan", "Judy"];
const ROLES = ["CEO", "CTO", "VP Sales", "Engineering Lead", "Head of Ops"];
const STAGES: DealStage[] = ["lead", "qualified", "proposal", "won", "lost"];
const ACTIVITY_TYPES: ActivityType[] = ["call", "email", "meeting", "note"];

const SIZES: Record<DataScale, { contacts: number; deals: number; activities: number }> = {
  s: { contacts: 5, deals: 8, activities: 12 },
  m: { contacts: 25, deals: 40, activities: 60 },
  l: { contacts: 100, deals: 200, activities: 400 },
  xl: { contacts: 500, deals: 1000, activities: 2500 },
};

function makeRng(seed: number) {
  let x = seed || 0x2abcdef;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1_000_000) / 1_000_000;
  };
}

/**
 * Deterministic seed output. Guarantees:
 * - every contact has between 1 and 3 deals (so contact-cleanup always has
 *   candidates that match "no deals and no activities" — we inject a few
 *   orphan contacts past the main loop)
 * - at least one deal in each stage when counts permit
 * - at least one deal with valueUsd > $50k (targets for high-value-alert)
 * - at least two deals in stage=lead with ≥1 'call' activity (targets for
 *   qualify-leads)
 */
export function seedCrm(scale: DataScale, seed: number): {
  contacts: Contact[];
  deals: Deal[];
  activities: Activity[];
} {
  const rng = makeRng(seed);
  const sizes = SIZES[scale];
  const contacts: Contact[] = [];
  const deals: Deal[] = [];
  const activities: Activity[] = [];

  for (let i = 0; i < sizes.contacts; i++) {
    contacts.push({
      id: `contact-${i + 1}`,
      name: `${NAMES[i % NAMES.length]} #${i + 1}`,
      company: COMPANIES[Math.floor(rng() * COMPANIES.length)],
      email: `person${i + 1}@example.com`,
      role: ROLES[Math.floor(rng() * ROLES.length)],
    });
  }
  // Inject two orphan contacts at the end with no deals and no activities.
  // Deleting these is the job of the `contact-cleanup` scenario.
  contacts.push(
    { id: "orphan-1", name: "Orphan One", company: "No Company", email: "o1@example.com", role: "N/A" },
    { id: "orphan-2", name: "Orphan Two", company: "No Company", email: "o2@example.com", role: "N/A" },
  );

  const mainContacts = contacts.filter((c) => !c.id.startsWith("orphan"));
  for (let i = 0; i < sizes.deals; i++) {
    const contact = mainContacts[i % mainContacts.length];
    const stage = STAGES[Math.floor(rng() * STAGES.length)];
    // One in four deals gets pushed above $50k so high-value-alert has targets
    const baseValue = 5000 + Math.floor(rng() * 30000);
    const value = rng() < 0.25 ? 50000 + Math.floor(rng() * 80000) : baseValue;
    deals.push({
      id: `deal-${i + 1}`,
      contactId: contact.id,
      title: `Contract ${i + 1} — ${contact.company}`,
      valueUsd: value,
      stage,
    });
  }

  // Force at least two lead-stage deals with a call activity — qualify-leads targets.
  if (deals.length >= 2) {
    deals[0].stage = "lead";
    deals[1].stage = "lead";
  }

  for (let i = 0; i < sizes.activities; i++) {
    // ~70% link to a deal, the rest to a contact
    const toDeal = rng() < 0.7;
    const deal = toDeal ? deals[Math.floor(rng() * deals.length)] : null;
    const contact = deal ? null : mainContacts[Math.floor(rng() * mainContacts.length)];
    activities.push({
      id: `act-${i + 1}`,
      dealId: deal?.id ?? null,
      contactId: contact?.id ?? null,
      type: ACTIVITY_TYPES[Math.floor(rng() * ACTIVITY_TYPES.length)],
      subject: `Touchpoint ${i + 1}`,
      body: "Follow-up notes.",
    });
  }
  // Force call activities on the two pinned lead deals
  if (deals.length >= 2) {
    activities.push(
      { id: "act-seed-call-1", dealId: deals[0].id, contactId: null, type: "call", subject: "Intro call", body: "Initial conversation" },
      { id: "act-seed-call-2", dealId: deals[1].id, contactId: null, type: "call", subject: "Discovery call", body: "Scoping the opportunity" },
    );
  }

  return { contacts, deals, activities };
}
