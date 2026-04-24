import type { JsonSchema } from "./types";

/**
 * Minimal JSON Schema validator for affordance invoke params.
 *
 * Covers the subset the SLOP affordance schema uses in practice:
 * - `type`: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null"
 * - `required`: string[]   (for objects)
 * - `properties`: Record<string, JsonSchema>  (for objects)
 * - `items`: JsonSchema    (for arrays)
 * - `enum`: readonly unknown[]
 *
 * Returns `null` on success, or a human-readable error message describing the
 * first failure. The message is used as the `message` field of an
 * `invalid_params` error result — see spec/core/affordances.md §invocation.
 */
export function validateParams(schema: JsonSchema | undefined, params: unknown): string | null {
  if (!schema) return null;
  return validate(schema, params, "params");
}

function validate(schema: JsonSchema, value: unknown, path: string): string | null {
  if (schema.enum && !schema.enum.some((v) => deepEqual(v, value))) {
    return `${path} must be one of ${JSON.stringify(schema.enum)}`;
  }

  switch (schema.type) {
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return `${path} must be an object`;
      }
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in obj)) {
          return `${path}.${key} is required`;
        }
      }
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in obj) {
            const err = validate(propSchema, obj[key], `${path}.${key}`);
            if (err) return err;
          }
        }
      }
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) return `${path} must be an array`;
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const err = validate(schema.items, value[i], `${path}[${i}]`);
          if (err) return err;
        }
      }
      return null;
    }
    case "string":
      return typeof value === "string" ? null : `${path} must be a string`;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : `${path} must be a number`;
    case "integer":
      return typeof value === "number" && Number.isInteger(value) ? null : `${path} must be an integer`;
    case "boolean":
      return typeof value === "boolean" ? null : `${path} must be a boolean`;
    case "null":
      return value === null ? null : `${path} must be null`;
    default:
      // Unknown type — be permissive rather than reject.
      return null;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}
