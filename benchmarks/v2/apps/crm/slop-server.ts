import { SlopServer } from "@slop-ai/server";
import { bunHandler } from "@slop-ai/server/bun";
import type { NodeDescriptor } from "@slop-ai/core";
import type { ActivityType, Contact, CrmStore, Deal, DealStage, Activity } from "./store.ts";

export interface CrmSlopOpts {
  maxNodes?: number;
  maxDepth?: number;
  /**
   * optimized=true: salience scoring across deals and activities, plus a
   * windowed deals collection ordered by relevance (open pipeline first).
   */
  optimized?: boolean;
}

export function createCrmSlopServer(store: CrmStore, opts?: CrmSlopOpts) {
  const slop = new SlopServer({
    id: "crm",
    name: "CRM",
    ...(opts?.maxNodes != null && { maxNodes: opts.maxNodes }),
    ...(opts?.maxDepth != null && { maxDepth: opts.maxDepth }),
  });

  const optimized = opts?.optimized ?? false;

  slop.register("overview", () => {
    const stageCounts = countByStage(store.deals);
    const totalValue = store.deals.reduce((s, d) => s + d.valueUsd, 0);
    const highValueCount = store.deals.filter((d) => d.valueUsd > 50000).length;
    return {
      type: "context",
      props: {
        contacts: store.contacts.length,
        deals: store.deals.length,
        activities: store.activities.length,
        pipeline_value_usd: totalValue,
        lead: stageCounts.lead,
        qualified: stageCounts.qualified,
        proposal: stageCounts.proposal,
        won: stageCounts.won,
        lost: stageCounts.lost,
      },
      summary:
        `${store.contacts.length} contacts, ${store.deals.length} deals ` +
        `(${stageCounts.lead}L/${stageCounts.qualified}Q/${stageCounts.proposal}P/${stageCounts.won}W/${stageCounts.lost}⊘), ` +
        `${store.activities.length} activities. ${highValueCount} deals >$50k.`,
    };
  });

  slop.register("contacts", () => {
    return {
      type: "collection",
      props: { count: store.contacts.length },
      summary: optimized ? `${store.contacts.length} contacts` : undefined,
      children: Object.fromEntries(
        store.contacts.map((c) => [c.id, buildContactNode(store, slop, c, optimized)]),
      ),
    } satisfies NodeDescriptor;
  });

  slop.register("deals", () => {
    const all = store.deals;
    if (optimized) {
      const scored = all.map((d) => ({ d, salience: dealSalience(d) }));
      scored.sort((a, b) => b.salience - a.salience);
      return {
        type: "collection",
        props: { count: all.length },
        summary: summarizeDeals(all),
        children: Object.fromEntries(
          scored.map(({ d, salience }) => [d.id, buildDealNode(store, slop, d, salience)]),
        ),
      } satisfies NodeDescriptor;
    }
    return {
      type: "collection",
      props: { count: all.length },
      children: Object.fromEntries(all.map((d) => [d.id, buildDealNode(store, slop, d)])),
    } satisfies NodeDescriptor;
  });

  slop.register("activities", () => {
    return {
      type: "collection",
      props: { count: store.activities.length },
      summary: optimized ? summarizeActivities(store.activities) : undefined,
      children: Object.fromEntries(
        store.activities.map((a) => [a.id, buildActivityNode(store, slop, a)]),
      ),
    } satisfies NodeDescriptor;
  });

  return slop;
}

function countByStage(deals: Deal[]): Record<DealStage, number> {
  const counts: Record<DealStage, number> = { lead: 0, qualified: 0, proposal: 0, won: 0, lost: 0 };
  for (const d of deals) counts[d.stage] += 1;
  return counts;
}

function summarizeDeals(deals: Deal[]): string {
  const counts = countByStage(deals);
  const highValue = deals.filter((d) => d.valueUsd > 50000).length;
  return `${deals.length} deals: ${counts.lead}L/${counts.qualified}Q/${counts.proposal}P/${counts.won}W/${counts.lost}⊘, ${highValue} >$50k`;
}

function summarizeActivities(acts: Activity[]): string {
  const byType: Record<string, number> = { call: 0, email: 0, meeting: 0, note: 0 };
  for (const a of acts) byType[a.type] = (byType[a.type] ?? 0) + 1;
  return `${acts.length} activities: ${byType.call} calls, ${byType.email} emails, ${byType.meeting} meetings, ${byType.note} notes`;
}

function dealSalience(d: Deal): number {
  const stageScore: Record<DealStage, number> = { lead: 0.5, qualified: 0.7, proposal: 0.8, won: 0.2, lost: 0.1 };
  const valueBoost = Math.min(0.3, d.valueUsd / 500_000);
  return Math.min(1, stageScore[d.stage] + valueBoost);
}

function buildContactNode(store: CrmStore, slop: SlopServer, c: Contact, _optimized: boolean): NodeDescriptor {
  return {
    type: "crm:contact",
    props: {
      name: c.name,
      company: c.company,
      email: c.email,
      role: c.role,
      deal_count: store.dealsForContact(c.id).length,
      activity_count: store.activitiesForContact(c.id).length,
    },
    actions: {
      edit_role: {
        label: "Edit role",
        description: "Change this contact's role",
        params: { role: { type: "string", description: "New role" } },
        handler: async (p) => {
          const target = store.getContact(c.id);
          if (target) target.role = String(p.role);
          slop.refresh();
          return { id: c.id };
        },
      },
      add_activity: {
        label: "Log activity",
        description: "Attach a new activity to this contact",
        params: {
          type: { type: "string", description: "call | email | meeting | note" },
          subject: { type: "string", description: "Activity subject" },
          body: { type: "string", description: "Activity body" },
        },
        handler: async (p) => {
          const a = store.addActivity({
            contactId: c.id,
            dealId: null,
            type: String(p.type) as ActivityType,
            subject: String(p.subject),
            body: String(p.body),
          });
          slop.refresh();
          return { id: a.id };
        },
      },
      delete: {
        label: "Delete contact",
        description: "Delete this contact",
        params: {},
        handler: async () => {
          store.deleteContact(c.id);
          slop.refresh();
          return { deleted: c.id };
        },
      },
    },
  };
}

function buildDealNode(store: CrmStore, slop: SlopServer, d: Deal, salience?: number): NodeDescriptor {
  const actions: NonNullable<NodeDescriptor["actions"]> = {
    edit_value: {
      label: "Edit value",
      description: "Set the deal's USD value",
      params: { value: { type: "number", description: "New value in USD" } },
      handler: async (p) => {
        store.setDealValue(d.id, Number(p.value));
        slop.refresh();
        return { id: d.id };
      },
    },
    add_activity: {
      label: "Log activity",
      description: "Attach a new activity to this deal",
      params: {
        type: { type: "string", description: "call | email | meeting | note" },
        subject: { type: "string", description: "Activity subject" },
        body: { type: "string", description: "Activity body" },
      },
      handler: async (p) => {
        const a = store.addActivity({
          contactId: null,
          dealId: d.id,
          type: String(p.type) as ActivityType,
          subject: String(p.subject),
          body: String(p.body),
        });
        slop.refresh();
        return { id: a.id };
      },
    },
    delete: {
      label: "Delete deal",
      description: "Delete this deal",
      params: {},
      handler: async () => {
        store.deleteDeal(d.id);
        slop.refresh();
        return { deleted: d.id };
      },
    },
  };

  // State-dependent stage transitions
  const stageTargets: Record<DealStage, DealStage[]> = {
    lead: ["qualified", "lost"],
    qualified: ["proposal", "lost"],
    proposal: ["won", "lost"],
    won: [],
    lost: [],
  };
  for (const target of stageTargets[d.stage]) {
    const actionName = `mark_${target}`;
    actions[actionName] = {
      label: `Mark ${target}`,
      description: `Advance this deal to stage "${target}"`,
      params: {},
      handler: async () => {
        store.advanceStage(d.id, target);
        slop.refresh();
        return { id: d.id, stage: target };
      },
    };
  }

  const node: NodeDescriptor = {
    type: "crm:deal",
    props: {
      contact_id: d.contactId,
      title: d.title,
      value_usd: d.valueUsd,
      stage: d.stage,
      activity_count: store.activitiesForDeal(d.id).length,
    },
    actions,
  };
  if (salience !== undefined) node.meta = { salience };
  return node;
}

function buildActivityNode(store: CrmStore, slop: SlopServer, a: Activity): NodeDescriptor {
  return {
    type: "crm:activity",
    props: {
      type: a.type,
      subject: a.subject,
      body: a.body,
      contact_id: a.contactId ?? "",
      deal_id: a.dealId ?? "",
    },
    actions: {
      delete: {
        label: "Delete activity",
        description: "Delete this activity",
        params: {},
        handler: async () => {
          store.deleteActivity(a.id);
          slop.refresh();
          return { deleted: a.id };
        },
      },
    },
  };
}

export function startCrmSlopServer(store: CrmStore, port: number, opts?: CrmSlopOpts) {
  const slop = createCrmSlopServer(store, opts);
  const handler = bunHandler(slop, { path: "/slop" });
  const server = Bun.serve({
    port,
    fetch(req, srv) {
      const resp = handler.fetch(req, srv);
      if (resp) return resp;
      return new Response("SLOP CRM benchmark server", { status: 200 });
    },
    websocket: handler.websocket,
  });
  return { server, slop };
}
