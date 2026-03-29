import { createSlopServer } from "@slop-ai/server";
import { getLinks, addLink, deleteLink, visitLink } from "./state.js";

export const slop = createSlopServer({ id: "sveltekit-links", name: "SvelteKit Links" });

slop.register("links", () => ({
  type: "collection",
  props: {
    total: getLinks().length,
    total_clicks: getLinks().reduce((sum, l) => sum + l.clicks, 0),
  },
  actions: {
    add_link: {
      params: { title: "string", url: "string" },
      handler: (params) => addLink(params.title as string, params.url as string),
    },
  },
  items: getLinks().map(l => ({
    id: l.id,
    props: { title: l.title, url: l.url, clicks: l.clicks, created: l.created },
    actions: {
      visit: () => visitLink(l.id),
      delete: { handler: () => deleteLink(l.id), dangerous: true },
    },
  })),
}));
