import {
  getContacts,
  addContact,
  editContact,
  deleteContact,
  toggleFavorite,
} from "../utils/state";
import { slop } from "../utils/slop";

export default defineEventHandler(async (event) => {
  const method = event.method;

  if (method === "GET") {
    return getContacts();
  }

  if (method === "POST") {
    const body = await readBody(event);
    addContact(body.name, body.email, body.phone || "");
    slop.refresh();
    return { ok: true };
  }

  if (method === "PATCH") {
    const query = getQuery(event);
    const body = await readBody(event);
    if (body.toggleFavorite) toggleFavorite(query.id as string);
    else editContact(query.id as string, body);
    slop.refresh();
    return { ok: true };
  }

  if (method === "DELETE") {
    const query = getQuery(event);
    deleteContact(query.id as string);
    slop.refresh();
    return { ok: true };
  }
});
