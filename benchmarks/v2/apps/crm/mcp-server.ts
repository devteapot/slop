/**
 * Stdio MCP server for the crm benchmark app. Spawned as a child process by
 * the MCP cell runner. Env vars:
 * - BENCH_SCALE = s | m | l | xl
 * - BENCH_SEED  = integer
 */

import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CrmStore, type ActivityType, type DealStage } from "./store.ts";
import { seedCrm } from "./seed.ts";
import type { DataScale } from "../../runner/types.ts";

const scale = (process.env.BENCH_SCALE as DataScale | undefined) ?? "s";
const seed = Number(process.env.BENCH_SEED ?? 42);

const store = new CrmStore();
const { contacts, deals, activities } = seedCrm(scale, seed);
store.reset(contacts, deals, activities);

const server = new Server({ name: "crm-mcp", version: "0.2.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "list_contacts", description: "List every contact", inputSchema: { type: "object" as const, properties: {} } },
    { name: "list_deals", description: "List every deal. Optional filter by stage.", inputSchema: { type: "object" as const, properties: { stage: { type: "string", description: "lead|qualified|proposal|won|lost" } } } },
    { name: "list_activities", description: "List every activity. Optional filter by dealId or contactId.", inputSchema: { type: "object" as const, properties: { deal_id: { type: "string" }, contact_id: { type: "string" } } } },
    { name: "get_contact", description: "Get a contact by id", inputSchema: { type: "object" as const, properties: { id: { type: "string" } }, required: ["id"] } },
    { name: "get_deal", description: "Get a deal by id", inputSchema: { type: "object" as const, properties: { id: { type: "string" } }, required: ["id"] } },
    { name: "get_activity", description: "Get an activity by id", inputSchema: { type: "object" as const, properties: { id: { type: "string" } }, required: ["id"] } },
    { name: "deals_for_contact", description: "Return every deal belonging to a contact", inputSchema: { type: "object" as const, properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "activities_for_deal", description: "Return every activity attached to a deal", inputSchema: { type: "object" as const, properties: { deal_id: { type: "string" } }, required: ["deal_id"] } },
    { name: "activities_for_contact", description: "Return every activity attached to a contact", inputSchema: { type: "object" as const, properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "advance_deal_stage", description: "Set a deal's stage", inputSchema: { type: "object" as const, properties: { id: { type: "string" }, stage: { type: "string", description: "lead|qualified|proposal|won|lost" } }, required: ["id", "stage"] } },
    { name: "set_deal_value", description: "Set a deal's USD value", inputSchema: { type: "object" as const, properties: { id: { type: "string" }, value: { type: "number" } }, required: ["id", "value"] } },
    { name: "add_activity", description: "Create a new activity on a deal or contact. Provide deal_id XOR contact_id.", inputSchema: { type: "object" as const, properties: { deal_id: { type: "string" }, contact_id: { type: "string" }, type: { type: "string", description: "call|email|meeting|note" }, subject: { type: "string" }, body: { type: "string" } }, required: ["type", "subject", "body"] } },
    { name: "delete_contact", description: "Delete a contact", inputSchema: { type: "object" as const, properties: { id: { type: "string" } }, required: ["id"] } },
    { name: "delete_deal", description: "Delete a deal", inputSchema: { type: "object" as const, properties: { id: { type: "string" } }, required: ["id"] } },
    { name: "delete_activity", description: "Delete an activity", inputSchema: { type: "object" as const, properties: { id: { type: "string" } }, required: ["id"] } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "list_contacts":
        return json(store.contacts);
      case "list_deals": {
        const stage = a.stage ? String(a.stage) : undefined;
        const deals = stage ? store.deals.filter((d) => d.stage === stage) : store.deals;
        return json(deals);
      }
      case "list_activities": {
        let out = store.activities;
        if (a.deal_id) out = out.filter((x) => x.dealId === a.deal_id);
        if (a.contact_id) out = out.filter((x) => x.contactId === a.contact_id);
        return json(out);
      }
      case "get_contact": return store.getContact(String(a.id)) ? json(store.getContact(String(a.id))) : err(`contact ${a.id} not found`);
      case "get_deal": return store.getDeal(String(a.id)) ? json(store.getDeal(String(a.id))) : err(`deal ${a.id} not found`);
      case "get_activity": return store.getActivity(String(a.id)) ? json(store.getActivity(String(a.id))) : err(`activity ${a.id} not found`);
      case "deals_for_contact": return json(store.dealsForContact(String(a.contact_id)));
      case "activities_for_deal": return json(store.activitiesForDeal(String(a.deal_id)));
      case "activities_for_contact": return json(store.activitiesForContact(String(a.contact_id)));
      case "advance_deal_stage": {
        const stage = String(a.stage);
        if (!["lead", "qualified", "proposal", "won", "lost"].includes(stage)) return err(`invalid stage ${stage}`);
        store.advanceStage(String(a.id), stage as DealStage);
        return json({ id: a.id, stage });
      }
      case "set_deal_value":
        store.setDealValue(String(a.id), Number(a.value));
        return json({ id: a.id, value: Number(a.value) });
      case "add_activity": {
        const missing = ["type", "subject", "body"].filter((k) => a[k] == null);
        if (missing.length > 0) return err(`missing required fields: ${missing.join(", ")}`);
        const type = String(a.type);
        if (!["call", "email", "meeting", "note"].includes(type)) return err(`invalid type: ${type} (expected call|email|meeting|note)`);
        const dealId = a.deal_id ? String(a.deal_id) : null;
        const contactId = a.contact_id ? String(a.contact_id) : null;
        if (dealId && contactId) return err("provide deal_id OR contact_id, not both");
        if (!dealId && !contactId) return err("provide deal_id OR contact_id");
        const activity = store.addActivity({
          dealId,
          contactId,
          type: type as ActivityType,
          subject: String(a.subject),
          body: String(a.body),
        });
        return json(activity);
      }
      case "delete_contact":
        store.deleteContact(String(a.id));
        return json({ deleted: a.id });
      case "delete_deal":
        store.deleteDeal(String(a.id));
        return json({ deleted: a.id });
      case "delete_activity":
        store.deleteActivity(String(a.id));
        return json({ deleted: a.id });
      default:
        return err(`unknown tool ${name}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
});

function json(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
function err(msg: string) {
  return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true };
}

const transport = new StdioServerTransport();
await server.connect(transport);
