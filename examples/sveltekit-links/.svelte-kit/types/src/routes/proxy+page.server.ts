// @ts-nocheck
import {
  getLinks,
  addLink,
  deleteLink,
  visitLink,
} from "$lib/server/state.js";
import { slop } from "$lib/server/slop.js";
import type { Actions, PageServerLoad } from "./$types";

export const load = () => {
  return { links: getLinks() };
};

export const actions = {
  add: async ({ request }: import('./$types').RequestEvent) => {
    const data = await request.formData();
    const title = data.get("title") as string;
    const url = data.get("url") as string;
    if (title && url) {
      addLink(title, url);
      slop.refresh();
    }
  },
  delete: async ({ request }: import('./$types').RequestEvent) => {
    const data = await request.formData();
    const id = data.get("id") as string;
    if (id) {
      deleteLink(id);
      slop.refresh();
    }
  },
  visit: async ({ request }: import('./$types').RequestEvent) => {
    const data = await request.formData();
    const id = data.get("id") as string;
    if (id) {
      visitLink(id);
      slop.refresh();
    }
  },
};
;null as any as PageServerLoad;;null as any as Actions;