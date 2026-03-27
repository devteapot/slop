export interface Affordance {
  action: string;
  label?: string;
  description?: string;
  params?: JsonSchema;
  dangerous?: boolean;
  idempotent?: boolean;
}

export type JsonSchema = {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  default?: unknown;
  enum?: unknown[];
};
