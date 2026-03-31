"""FastAPI application with SLOP middleware and REST endpoints."""

from __future__ import annotations

from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from slop import SlopServer
from slop.transports.asgi import SlopMiddleware

from .state import state
from .slop_tree import register_tree

# --- SLOP server ---

slop = SlopServer("contacts-api", "Contacts API")

# --- FastAPI app ---

app = FastAPI(title="Contacts API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(SlopMiddleware, slop=slop)


# --- Startup ---

@app.on_event("startup")
def startup() -> None:
    state.load()
    register_tree(slop)
    slop.refresh()


# --- Helpers ---

def _contact_dict(c: Any) -> dict[str, Any]:
    salience, reason = state.compute_salience(c)
    d: dict[str, Any] = {
        "id": c.id,
        "name": c.name,
        "email": c.email,
        "phone": c.phone,
        "company": c.company,
        "title": c.title,
        "tags": c.tags,
        "starred": c.starred,
        "notes": c.notes,
        "created_at": c.created_at,
        "updated_at": c.updated_at,
        "salience": salience,
        "salience_reason": reason,
    }
    return d


# --- REST endpoints ---

@app.get("/api/contacts")
def list_contacts(
    q: str | None = Query(None),
    tag: str | None = Query(None),
) -> dict[str, Any]:
    if q:
        contacts = state.search_contacts(q)
    elif tag:
        contacts = state.filter_by_tag(tag)
    else:
        contacts = state.get_contacts()
    return {"contacts": [_contact_dict(c) for c in contacts]}


@app.get("/api/contacts/{contact_id}")
def get_contact(contact_id: str) -> dict[str, Any]:
    c = state.get_contact(contact_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    activities = state.get_activity(contact_id)
    d = _contact_dict(c)
    d["activity"] = [
        {
            "id": a.id,
            "type": a.type,
            "description": a.description,
            "timestamp": a.timestamp,
        }
        for a in sorted(activities, key=lambda a: a.timestamp, reverse=True)
    ]
    return d


@app.post("/api/contacts", status_code=201)
def create_contact(body: dict[str, Any]) -> dict[str, Any]:
    c = state.create_contact(
        name=body.get("name", ""),
        email=body.get("email", ""),
        phone=body.get("phone", ""),
        company=body.get("company", ""),
        title=body.get("title", ""),
        tags=body.get("tags"),
    )
    slop.refresh()
    return _contact_dict(c)


@app.put("/api/contacts/{contact_id}")
def edit_contact(contact_id: str, body: dict[str, Any]) -> dict[str, Any]:
    c = state.edit_contact(contact_id, **body)
    if c is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    slop.refresh()
    return _contact_dict(c)


@app.delete("/api/contacts/{contact_id}")
def delete_contact(contact_id: str) -> dict[str, str]:
    if not state.delete_contact(contact_id):
        raise HTTPException(status_code=404, detail="Contact not found")
    slop.refresh()
    return {"status": "deleted"}


@app.post("/api/contacts/{contact_id}/star")
def star_contact(contact_id: str) -> dict[str, Any]:
    if not state.star(contact_id):
        raise HTTPException(status_code=404, detail="Contact not found")
    slop.refresh()
    return _contact_dict(state.get_contact(contact_id))  # type: ignore[arg-type]


@app.delete("/api/contacts/{contact_id}/star")
def unstar_contact(contact_id: str) -> dict[str, Any]:
    if not state.unstar(contact_id):
        raise HTTPException(status_code=404, detail="Contact not found")
    slop.refresh()
    return _contact_dict(state.get_contact(contact_id))  # type: ignore[arg-type]


@app.post("/api/contacts/{contact_id}/tags")
def add_tag(contact_id: str, body: dict[str, Any]) -> dict[str, Any]:
    tag = body.get("tag", "")
    if not tag:
        raise HTTPException(status_code=400, detail="Tag is required")
    if not state.add_tag(contact_id, tag):
        raise HTTPException(status_code=404, detail="Contact not found")
    slop.refresh()
    return _contact_dict(state.get_contact(contact_id))  # type: ignore[arg-type]


@app.delete("/api/contacts/{contact_id}/tags/{tag}")
def remove_tag(contact_id: str, tag: str) -> dict[str, Any]:
    if not state.remove_tag(contact_id, tag):
        raise HTTPException(status_code=404, detail="Contact not found")
    slop.refresh()
    return _contact_dict(state.get_contact(contact_id))  # type: ignore[arg-type]


@app.post("/api/contacts/{contact_id}/notes")
def add_note(contact_id: str, body: dict[str, Any]) -> dict[str, Any]:
    content = body.get("content", "")
    if not content:
        raise HTTPException(status_code=400, detail="Content is required")
    if not state.add_note(contact_id, content):
        raise HTTPException(status_code=404, detail="Contact not found")
    slop.refresh()
    return _contact_dict(state.get_contact(contact_id))  # type: ignore[arg-type]


@app.post("/api/contacts/{contact_id}/activity")
def log_activity(contact_id: str, body: dict[str, Any]) -> dict[str, Any]:
    act_type = body.get("type", "")
    description = body.get("description", "")
    if not act_type or not description:
        raise HTTPException(status_code=400, detail="Type and description required")
    c = state.get_contact(contact_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    act = state.log_activity(contact_id, act_type, description)
    slop.refresh()
    return {"id": act.id, "type": act.type, "description": act.description, "timestamp": act.timestamp}


@app.get("/api/tags")
def list_tags() -> dict[str, Any]:
    tags = state.get_tags()
    return {
        "tags": [
            {"name": t, "contact_count": state.tag_contact_count(t)}
            for t in tags
        ]
    }


@app.put("/api/tags/{name}")
def rename_tag(name: str, body: dict[str, Any]) -> dict[str, Any]:
    new_name = body.get("new_name", "")
    if not new_name:
        raise HTTPException(status_code=400, detail="new_name is required")
    count = state.rename_tag(name, new_name)
    slop.refresh()
    return {"old_name": name, "new_name": new_name, "contacts_updated": count}


# --- Entry point ---

def run() -> None:
    uvicorn.run(
        "contacts_api.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )


if __name__ == "__main__":
    run()
