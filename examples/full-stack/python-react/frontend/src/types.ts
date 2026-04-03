export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  title: string;
  tags: string[];
  starred: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  contact_id: string;
  type: string;
  description: string;
  timestamp: string;
}
