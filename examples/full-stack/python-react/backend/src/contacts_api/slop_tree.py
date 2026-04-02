"""SLOP tree registrations for the contact manager.

Registers the contacts collection (windowed, sorted by salience) and the
tags collection on a SlopServer instance.
"""

from __future__ import annotations

from typing import Any

from slop_ai import SlopServer

from .state import state, Contact


WINDOW_SIZE = 20


def register_tree(slop: SlopServer) -> None:
    """Register all SLOP nodes on the server."""

    # --- helpers (closures so they can reference slop) ---

    def _make_contact_actions(contact_id: str) -> dict[str, Any]:
        """Inline action descriptors for a single contact item."""
        return {
            "edit": {
                "handler": lambda params, cid=contact_id: state.edit_contact(cid, **params),
                "idempotent": True,
                "params": {
                    "name": "string",
                    "email": "string",
                    "phone": "string",
                    "company": "string",
                    "title": "string",
                },
            },
            "delete": {
                "handler": lambda params, cid=contact_id: state.delete_contact(cid),
                "dangerous": True,
            },
            "star": {
                "handler": lambda params, cid=contact_id: state.star(cid),
                "idempotent": True,
            },
            "unstar": {
                "handler": lambda params, cid=contact_id: state.unstar(cid),
                "idempotent": True,
            },
            "add_tag": {
                "handler": lambda params, cid=contact_id: state.add_tag(cid, params["tag"]),
                "params": {"tag": "string"},
            },
            "remove_tag": {
                "handler": lambda params, cid=contact_id: state.remove_tag(cid, params["tag"]),
                "params": {"tag": "string"},
            },
            "add_note": {
                "handler": lambda params, cid=contact_id: state.add_note(cid, params["content"]),
                "params": {"content": "string"},
            },
            "log_activity": {
                "handler": lambda params, cid=contact_id: state.log_activity(
                    cid, params["type"], params["description"],
                ),
                "params": {"type": "string", "description": "string"},
            },
        }

    def _contact_item(contact: Contact) -> dict[str, Any]:
        """Build a full item descriptor for a contact."""
        salience, reason = state.compute_salience(contact)

        meta: dict[str, Any] = {"salience": salience, "reason": reason}
        if contact.starred:
            meta["pinned"] = True

        item: dict[str, Any] = {
            "id": contact.id,
            "props": {
                "name": contact.name,
                "email": contact.email,
                "phone": contact.phone,
                "company": contact.company,
                "title": contact.title,
                "tags": list(contact.tags),
                "starred": contact.starred,
            },
            "meta": meta,
            "actions": _make_contact_actions(contact.id),
        }

        # Content ref for notes
        if contact.notes:
            item["content_ref"] = {
                "type": "text",
                "mime": "text/plain",
                "summary": contact.notes[:80],
                "preview": contact.notes[:200],
                "size": len(contact.notes),
            }

        # Activity child collection
        activities = state.get_activity(contact.id)
        item["children"] = {
            "activity": {
                "type": "collection",
                "props": {"count": len(activities)},
                "items": [
                    {
                        "id": a.id,
                        "props": {
                            "type": a.type,
                            "description": a.description,
                            "timestamp": a.timestamp,
                        },
                    }
                    for a in sorted(activities, key=lambda a: a.timestamp, reverse=True)
                ],
            },
        }

        return item

    def _sorted_contacts() -> list[Contact]:
        contacts = state.get_contacts()
        contacts.sort(key=lambda c: state.compute_salience(c)[0], reverse=True)
        return contacts

    # --- Contacts collection ---

    @slop.node("contacts")
    def contacts_node() -> dict[str, Any]:
        contacts = _sorted_contacts()
        total = len(contacts)
        starred = sum(1 for c in contacts if c.starred)
        window = contacts[:WINDOW_SIZE]

        return {
            "type": "collection",
            "props": {"count": total, "starred": starred},
            "window": {
                "offset": 0,
                "total": total,
                "items": [_contact_item(c) for c in window],
            },
            "actions": {
                "create": {
                    "handler": lambda params: _handle_create(params),
                    "params": {
                        "name": "string",
                        "email": "string",
                        "phone": "string",
                        "company": "string",
                        "title": "string",
                        "tags": {"type": "array", "items": {"type": "string"}},
                    },
                },
                "search": {
                    "handler": lambda params: _handle_search(params),
                    "params": {"query": "string"},
                },
            },
        }

    # --- Tags collection ---

    @slop.node("tags")
    def tags_node() -> dict[str, Any]:
        tags = state.get_tags()
        return {
            "type": "collection",
            "props": {"count": len(tags)},
            "items": [
                {
                    "id": f"tag-{tag}",
                    "props": {
                        "name": tag,
                        "contact_count": state.tag_contact_count(tag),
                    },
                    "actions": {
                        "rename": {
                            "handler": lambda params, t=tag: state.rename_tag(t, params["new_name"]),
                            "params": {"new_name": "string"},
                        },
                    },
                }
                for tag in tags
            ],
        }

    # --- Collection-level action handlers ---

    def _handle_create(params: dict[str, Any]) -> dict[str, Any]:
        c = state.create_contact(
            name=params.get("name", ""),
            email=params.get("email", ""),
            phone=params.get("phone", ""),
            company=params.get("company", ""),
            title=params.get("title", ""),
            tags=params.get("tags"),
        )
        return {"id": c.id}

    def _handle_search(params: dict[str, Any]) -> dict[str, Any]:
        query = params.get("query", "")
        results = state.search_contacts(query)
        return {
            "count": len(results),
            "contacts": [
                {"id": c.id, "name": c.name, "email": c.email, "company": c.company}
                for c in results
            ],
        }
