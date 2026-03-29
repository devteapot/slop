import { createSlopServer } from "@slop-ai/server";
import {
  getContacts,
  addContact,
  editContact,
  deleteContact,
  toggleFavorite,
} from "./state";

export const slop = createSlopServer({ id: "nuxt-contacts", name: "Nuxt Contacts" });

slop.register("contacts", () => ({
  type: "collection",
  props: {
    total: getContacts().length,
    favorites: getContacts().filter(c => c.favorite).length,
  },
  actions: {
    add_contact: {
      params: { name: "string", email: "string", phone: "string" },
      handler: (params) => addContact(params.name as string, params.email as string, (params.phone as string) || ""),
    },
  },
  items: getContacts().map(c => ({
    id: c.id,
    props: { name: c.name, email: c.email, phone: c.phone, favorite: c.favorite },
    actions: {
      toggle_favorite: () => toggleFavorite(c.id),
      edit: {
        params: { name: "string", email: "string", phone: "string" },
        handler: (params) => editContact(c.id, params as any),
      },
      delete: { handler: () => deleteContact(c.id), dangerous: true },
    },
  })),
}));
