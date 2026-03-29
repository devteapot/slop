import { d as defineEventHandler, r as readBody, g as getQuery } from '../../nitro/nitro.mjs';
import { g as getContacts, a as addContact, t as toggleFavorite, e as editContact, d as deleteContact } from '../../_/state.mjs';
import 'node:http';
import 'node:https';
import 'node:crypto';
import 'stream';
import 'events';
import 'http';
import 'crypto';
import 'buffer';
import 'zlib';
import 'https';
import 'net';
import 'tls';
import 'url';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:url';

const contacts = defineEventHandler(async (event) => {
  const method = event.method;
  if (method === "GET") {
    return getContacts();
  }
  if (method === "POST") {
    const body = await readBody(event);
    addContact(body.name, body.email, body.phone || "");
    return { ok: true };
  }
  if (method === "PATCH") {
    const query = getQuery(event);
    const body = await readBody(event);
    if (body.toggleFavorite) toggleFavorite(query.id);
    else editContact(query.id, body);
    return { ok: true };
  }
  if (method === "DELETE") {
    const query = getQuery(event);
    deleteContact(query.id);
    return { ok: true };
  }
});

export { contacts as default };
//# sourceMappingURL=contacts.mjs.map
