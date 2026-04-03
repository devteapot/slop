"""In-memory contact store, loaded from seed.json."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class Contact:
    id: str
    name: str
    email: str = ""
    phone: str = ""
    company: str = ""
    title: str = ""
    tags: list[str] = field(default_factory=list)
    starred: bool = False
    notes: str = ""
    created_at: str = ""
    updated_at: str = ""


@dataclass
class Activity:
    id: str
    contact_id: str
    type: str
    description: str
    timestamp: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_seed() -> tuple[list[Contact], list[Activity]]:
    """Load seed.json from the parent directory of the backend."""
    seed_path = Path(__file__).resolve().parents[3] / "seed.json"
    with open(seed_path) as f:
        data = json.load(f)

    contacts = [
        Contact(
            id=c["id"],
            name=c["name"],
            email=c.get("email", ""),
            phone=c.get("phone", ""),
            company=c.get("company", ""),
            title=c.get("title", ""),
            tags=list(c.get("tags", [])),
            starred=c.get("starred", False),
            notes=c.get("notes", ""),
            created_at=c.get("created_at", ""),
            updated_at=c.get("updated_at", ""),
        )
        for c in data["contacts"]
    ]

    activity = [
        Activity(
            id=a["id"],
            contact_id=a["contact_id"],
            type=a["type"],
            description=a["description"],
            timestamp=a["timestamp"],
        )
        for a in data["activity"]
    ]

    return contacts, activity


class State:
    """In-memory store for contacts and activity."""

    def __init__(self) -> None:
        self.contacts: list[Contact] = []
        self.activity: list[Activity] = []
        self._next_contact = 1
        self._next_activity = 1

    def load(self) -> None:
        self.contacts, self.activity = load_seed()
        # Set counters beyond seed data
        cids = [int(c.id.split("-")[1]) for c in self.contacts if "-" in c.id]
        aids = [int(a.id.split("-")[1]) for a in self.activity if "-" in a.id]
        self._next_contact = max(cids, default=0) + 1
        self._next_activity = max(aids, default=0) + 1

    # --- Reads ---

    def get_contacts(self) -> list[Contact]:
        return list(self.contacts)

    def get_contact(self, id: str) -> Contact | None:
        for c in self.contacts:
            if c.id == id:
                return c
        return None

    def search_contacts(self, query: str) -> list[Contact]:
        q = query.lower()
        return [
            c for c in self.contacts
            if q in c.name.lower()
            or q in c.email.lower()
            or q in c.company.lower()
            or q in c.title.lower()
        ]

    def filter_by_tag(self, tag: str) -> list[Contact]:
        return [c for c in self.contacts if tag in c.tags]

    # --- Mutations ---

    def create_contact(
        self,
        name: str,
        email: str = "",
        phone: str = "",
        company: str = "",
        title: str = "",
        tags: list[str] | None = None,
    ) -> Contact:
        contact = Contact(
            id=f"contact-{self._next_contact}",
            name=name,
            email=email,
            phone=phone,
            company=company,
            title=title,
            tags=tags or [],
            starred=False,
            notes="",
            created_at=_now_iso(),
            updated_at=_now_iso(),
        )
        self._next_contact += 1
        self.contacts.append(contact)
        return contact

    def edit_contact(self, id: str, **fields: Any) -> Contact | None:
        c = self.get_contact(id)
        if c is None:
            return None
        for key in ("name", "email", "phone", "company", "title"):
            if key in fields and fields[key] is not None:
                setattr(c, key, fields[key])
        c.updated_at = _now_iso()
        return c

    def delete_contact(self, id: str) -> bool:
        for i, c in enumerate(self.contacts):
            if c.id == id:
                self.contacts.pop(i)
                self.activity = [a for a in self.activity if a.contact_id != id]
                return True
        return False

    def star(self, id: str) -> bool:
        c = self.get_contact(id)
        if c is None:
            return False
        c.starred = True
        c.updated_at = _now_iso()
        return True

    def unstar(self, id: str) -> bool:
        c = self.get_contact(id)
        if c is None:
            return False
        c.starred = False
        c.updated_at = _now_iso()
        return True

    def add_tag(self, id: str, tag: str) -> bool:
        c = self.get_contact(id)
        if c is None:
            return False
        if tag not in c.tags:
            c.tags.append(tag)
            c.updated_at = _now_iso()
        return True

    def remove_tag(self, id: str, tag: str) -> bool:
        c = self.get_contact(id)
        if c is None:
            return False
        if tag in c.tags:
            c.tags.remove(tag)
            c.updated_at = _now_iso()
        return True

    def add_note(self, id: str, content: str) -> bool:
        c = self.get_contact(id)
        if c is None:
            return False
        if c.notes:
            c.notes += "\n\n" + content
        else:
            c.notes = content
        c.updated_at = _now_iso()
        self.log_activity(id, "note", "Note added")
        return True

    def log_activity(self, contact_id: str, type: str, description: str) -> Activity:
        act = Activity(
            id=f"act-{self._next_activity}",
            contact_id=contact_id,
            type=type,
            description=description,
            timestamp=_now_iso(),
        )
        self._next_activity += 1
        self.activity.append(act)
        return act

    # --- Tags ---

    def get_tags(self) -> list[str]:
        tags: set[str] = set()
        for c in self.contacts:
            tags.update(c.tags)
        return sorted(tags)

    def tag_contact_count(self, tag: str) -> int:
        return sum(1 for c in self.contacts if tag in c.tags)

    def rename_tag(self, old: str, new: str) -> int:
        count = 0
        for c in self.contacts:
            if old in c.tags:
                c.tags = [new if t == old else t for t in c.tags]
                c.updated_at = _now_iso()
                count += 1
        return count

    # --- Activity ---

    def get_activity(self, contact_id: str) -> list[Activity]:
        return [a for a in self.activity if a.contact_id == contact_id]

    # --- Salience ---

    def compute_salience(self, contact: Contact) -> tuple[float, str]:
        """Return (salience, reason) for a contact."""
        now = datetime.now(timezone.utc)
        activities = self.get_activity(contact.id)

        recent_7d = False
        recent_30d = False
        if activities:
            latest = max(
                datetime.fromisoformat(a.timestamp.replace("Z", "+00:00"))
                for a in activities
            )
            days = (now - latest).days
            if days <= 7:
                recent_7d = True
            if days <= 30:
                recent_30d = True

        if contact.starred and recent_7d:
            # 0.9-1.0 range; more recent = higher
            if activities:
                latest_ts = max(
                    datetime.fromisoformat(a.timestamp.replace("Z", "+00:00"))
                    for a in activities
                )
                days = (now - latest_ts).days
                score = 0.9 + (0.1 * max(0, (7 - days)) / 7)
                return round(min(score, 1.0), 2), "starred + recent activity"
            return 0.9, "starred + recent activity"
        elif contact.starred:
            return 0.7, "starred"
        elif recent_7d:
            if activities:
                latest_ts = max(
                    datetime.fromisoformat(a.timestamp.replace("Z", "+00:00"))
                    for a in activities
                )
                days = (now - latest_ts).days
                score = 0.6 + (0.2 * max(0, (7 - days)) / 7)
                return round(min(score, 0.8), 2), "recent activity"
            return 0.6, "recent activity"
        elif recent_30d:
            return 0.45, "active this month"
        else:
            return 0.2, "inactive"


# Singleton state
state = State()
