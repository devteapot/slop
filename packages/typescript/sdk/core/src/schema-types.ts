/**
 * Compile-time path validation for typed SLOP schemas.
 *
 * Usage:
 *   const schema = { inbox: { messages: "collection", compose: "form" } } as const;
 *   type Paths = ExtractPaths<typeof schema>;
 *   // → "inbox" | "inbox/messages" | "inbox/compose"
 */

/** Recursively extract all valid paths from a schema object */
export type ExtractPaths<S> = S extends string
  ? never
  : S extends Record<string, any>
    ? {
        [K in keyof S & string]: K | `${K}/${ExtractPaths<S[K]>}`;
      }[keyof S & string]
    : string; // fallback: no schema = any string

/** Extract the sub-schema at a given path */
export type ExtractSubSchema<S, P extends string> =
  P extends `${infer Head}/${infer Rest}`
    ? Head extends keyof S
      ? ExtractSubSchema<S[Head], Rest>
      : unknown
    : P extends keyof S
      ? S[P]
      : unknown;
