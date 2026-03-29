import { a as defineWebSocketHandler } from '../nitro/nitro.mjs';
import { g as getContacts, o as onStateChange, b as getVersion, a as addContact, t as toggleFavorite, e as editContact, d as deleteContact } from '../_/state.mjs';
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

function buildTree() {
  const contacts = getContacts();
  return {
    id: "root",
    type: "root",
    properties: {
      label: "Contacts",
      total: contacts.length,
      favorites: contacts.filter((c) => c.favorite).length
    },
    affordances: [
      {
        action: "add_contact",
        label: "Add Contact",
        params: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" }
          },
          required: ["name", "email"]
        }
      }
    ],
    children: contacts.map((c) => ({
      id: c.id,
      type: "item",
      properties: {
        name: c.name,
        email: c.email,
        phone: c.phone,
        favorite: c.favorite
      },
      affordances: [
        {
          action: "toggle_favorite",
          label: c.favorite ? "Remove from favorites" : "Add to favorites"
        },
        {
          action: "edit",
          label: "Edit contact",
          params: {
            type: "object",
            properties: {
              name: { type: "string" },
              email: { type: "string" },
              phone: { type: "string" }
            }
          }
        },
        { action: "delete", label: "Delete contact", dangerous: true }
      ]
    }))
  };
}

const subs = [];
function broadcast() {
  const tree = buildTree();
  const version = getVersion();
  for (const sub of subs) {
    try {
      sub.peer.send(
        JSON.stringify({ type: "snapshot", id: sub.id, version, tree })
      );
    } catch {
    }
  }
}
onStateChange(broadcast);
const slop = defineWebSocketHandler({
  open(peer) {
    peer.send(
      JSON.stringify({
        type: "hello",
        provider: {
          id: "nuxt-contacts",
          name: "Nuxt Contacts",
          slop_version: "0.1",
          capabilities: ["state", "patches", "affordances"]
        }
      })
    );
  },
  message(peer, message) {
    const msg = JSON.parse(message.text());
    if (msg.type === "subscribe") {
      subs.push({ id: msg.id, peer });
      peer.send(
        JSON.stringify({
          type: "snapshot",
          id: msg.id,
          version: getVersion(),
          tree: buildTree()
        })
      );
    } else if (msg.type === "invoke") {
      handleInvoke(msg, peer);
    } else if (msg.type === "unsubscribe") {
      const idx = subs.findIndex((s) => s.id === msg.id && s.peer === peer);
      if (idx >= 0) subs.splice(idx, 1);
    }
  },
  close(peer) {
    for (let i = subs.length - 1; i >= 0; i--) {
      if (subs[i].peer === peer) subs.splice(i, 1);
    }
  }
});
function handleInvoke(msg, peer) {
  const { id, path, action, params } = msg;
  try {
    if (path === "/" && action === "add_contact") {
      addContact(params.name, params.email, params.phone || "");
    } else {
      const contactId = path.replace(/^\//, "");
      if (action === "toggle_favorite") toggleFavorite(contactId);
      else if (action === "edit") editContact(contactId, params);
      else if (action === "delete") deleteContact(contactId);
      else throw new Error(`Unknown action: ${action}`);
    }
    peer.send(JSON.stringify({ type: "result", id, status: "ok" }));
  } catch (e) {
    peer.send(
      JSON.stringify({
        type: "result",
        id,
        status: "error",
        error: { code: "invoke_failed", message: e.message }
      })
    );
  }
}

export { slop as default };
//# sourceMappingURL=slop.mjs.map
