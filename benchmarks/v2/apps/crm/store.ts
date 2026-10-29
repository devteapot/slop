export type DealStage = "lead" | "qualified" | "proposal" | "won" | "lost";
export type ActivityType = "call" | "email" | "meeting" | "note";

export interface Contact {
  id: string;
  name: string;
  company: string;
  email: string;
  role: string;
}

export interface Deal {
  id: string;
  contactId: string;
  title: string;
  valueUsd: number;
  stage: DealStage;
}

export interface Activity {
  id: string;
  contactId: string | null;
  dealId: string | null;
  type: ActivityType;
  subject: string;
  body: string;
}

export class CrmStore {
  contacts: Contact[] = [];
  deals: Deal[] = [];
  activities: Activity[] = [];

  reset(contacts: Contact[], deals: Deal[], activities: Activity[]) {
    this.contacts = contacts.map((c) => ({ ...c }));
    this.deals = deals.map((d) => ({ ...d }));
    this.activities = activities.map((a) => ({ ...a }));
  }

  getContact(id: string): Contact | undefined {
    return this.contacts.find((c) => c.id === id);
  }
  getDeal(id: string): Deal | undefined {
    return this.deals.find((d) => d.id === id);
  }
  getActivity(id: string): Activity | undefined {
    return this.activities.find((a) => a.id === id);
  }

  advanceStage(dealId: string, stage: DealStage): Deal {
    const d = this.getDeal(dealId);
    if (!d) throw new Error(`deal ${dealId} not found`);
    d.stage = stage;
    return d;
  }

  setDealValue(dealId: string, valueUsd: number): Deal {
    const d = this.getDeal(dealId);
    if (!d) throw new Error(`deal ${dealId} not found`);
    d.valueUsd = valueUsd;
    return d;
  }

  addActivity(a: Omit<Activity, "id"> & { id?: string }): Activity {
    const id = a.id ?? `act-${this.activities.length + 1}`;
    const activity: Activity = { id, ...a };
    this.activities.push(activity);
    return activity;
  }

  deleteContact(id: string): void {
    this.contacts = this.contacts.filter((c) => c.id !== id);
  }

  deleteDeal(id: string): void {
    this.deals = this.deals.filter((d) => d.id !== id);
  }

  deleteActivity(id: string): void {
    this.activities = this.activities.filter((a) => a.id !== id);
  }

  dealsForContact(contactId: string): Deal[] {
    return this.deals.filter((d) => d.contactId === contactId);
  }

  activitiesForContact(contactId: string): Activity[] {
    return this.activities.filter((a) => a.contactId === contactId);
  }

  activitiesForDeal(dealId: string): Activity[] {
    return this.activities.filter((a) => a.dealId === dealId);
  }
}
