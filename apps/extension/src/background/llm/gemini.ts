import type { LlmProfile } from "../../types";
import type { ChatMessage, LlmTool } from "@slop-ai/consumer/browser";

function makeGeminiName(original: string): string {
  // Gemini limits function names to 64 chars, must be [a-zA-Z_][a-zA-Z0-9_]*
  const name = "fn_" + original.replace(/[^a-zA-Z0-9_]/g, "_");
  if (name.length <= 64) return name;
  // Truncation would lose the action suffix, causing collisions.
  // Append a short hash to keep truncated names unique.
  const h = fnv1a(name);
  return name.slice(0, 56) + "_" + h;
}

/** FNV-1a hash → 7-char base36 string (fits in 64 - 56 - 1 = 7 chars) */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0");
}

function convertSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { type: schema.type ?? "object" };
  if (schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(schema.properties as Record<string, any>)) {
      const prop: Record<string, unknown> = { type: val.type ?? "string" };
      if (val.description) prop.description = val.description;
      if (val.enum) prop.enum = val.enum;
      if (val.items) prop.items = convertSchemaForGemini(val.items);
      props[key] = prop;
    }
    result.properties = props;
  }
  if (schema.items) result.items = convertSchemaForGemini(schema.items as Record<string, unknown>);
  if (schema.required) result.required = schema.required;
  return result;
}

export async function geminiChatCompletion(
  profile: LlmProfile,
  messages: ChatMessage[],
  tools: LlmTool[]
): Promise<ChatMessage> {
  const baseUrl = profile.endpoint || "https://generativelanguage.googleapis.com";
  const url = `${baseUrl}/v1beta/models/${profile.model}:generateContent?key=${profile.apiKey}`;

  // Name mapping: ONLY current tools populate the reverse map.
  // History names get forward mapping only — prevents stale names from winning.
  const nameToGemini = new Map<string, string>();
  const geminiToName = new Map<string, string>();

  // Current tools are authoritative for reverse lookup
  for (const t of tools) {
    const gname = makeGeminiName(t.function.name);
    nameToGemini.set(t.function.name, gname);
    geminiToName.set(gname, t.function.name);
  }

  // History names: forward mapping only (for building Gemini contents)
  for (const msg of messages) {
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (!nameToGemini.has(tc.function.name)) {
          nameToGemini.set(tc.function.name, makeGeminiName(tc.function.name));
        }
      }
    }
    if (msg.tool_call_id && !nameToGemini.has(msg.tool_call_id)) {
      nameToGemini.set(msg.tool_call_id, makeGeminiName(msg.tool_call_id));
    }
  }

  // Build Gemini contents
  const contents: any[] = [];
  let systemInstruction: any = undefined;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "system") {
      systemInstruction = { parts: [{ text: msg.content }] };
      continue;
    }
    if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.content }] });
    } else if (msg.role === "assistant") {
      const parts: any[] = [];
      if (msg.content) parts.push({ text: msg.content });
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          const gname = nameToGemini.get(tc.function.name) ?? makeGeminiName(tc.function.name);
          parts.push({
            functionCall: {
              name: gname,
              args: JSON.parse(tc.function.arguments || "{}"),
            },
          });
        }
      }
      contents.push({ role: "model", parts });
    } else if (msg.role === "tool") {
      // Batch consecutive tool messages into one function content
      const responseParts: any[] = [];
      let j = i;
      while (j < messages.length && messages[j].role === "tool") {
        const toolMsg = messages[j];
        const tcId = toolMsg.tool_call_id ?? "unknown";
        const gname = nameToGemini.get(tcId) ?? makeGeminiName(tcId);
        responseParts.push({
          functionResponse: {
            name: gname,
            response: { content: toolMsg.content },
          },
        });
        j++;
      }
      contents.push({ role: "function", parts: responseParts });
      i = j - 1; // skip consumed messages
    }
  }

  // Build Gemini tool declarations
  const geminiTools: any[] = [];
  if (tools.length > 0) {
    geminiTools.push({
      functionDeclarations: tools.map((t) => {
        const gname = nameToGemini.get(t.function.name) ?? makeGeminiName(t.function.name);
        return {
          name: gname,
          description: `[${t.function.name}] ${t.function.description}`,
          parameters: convertSchemaForGemini(t.function.parameters),
        };
      }),
    });
  }

  const body: Record<string, unknown> = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (geminiTools.length > 0) body.tools = geminiTools;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts) {
    throw new Error("No response from Gemini");
  }

  const parts = candidate.content.parts;
  const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text);
  const functionCalls = parts.filter((p: any) => p.functionCall);

  const result: ChatMessage = {
    role: "assistant",
    content: textParts.join("") || "",
  };

  if (functionCalls.length > 0) {
    result.tool_calls = functionCalls.map((fc: any) => {
      const geminiName: string = fc.functionCall.name ?? "";

      // Direct reverse lookup
      let originalName = geminiToName.get(geminiName);

      if (!originalName) {
        // Sorted-segment fallback: Gemini sometimes reorders segments
        const responseSorted = geminiName.split("_").filter(Boolean).sort();
        for (const [gname, original] of geminiToName) {
          const candidateSorted = gname.split("_").filter(Boolean).sort();
          if (candidateSorted.length === responseSorted.length &&
              candidateSorted.every((s, i) => s === responseSorted[i])) {
            originalName = original;
            break;
          }
        }
      }

      if (!originalName) {
        // Last resort: strip fn_ prefix and use raw name
        originalName = geminiName.startsWith("fn_") ? geminiName.slice(3) : geminiName;
      }

      return {
        id: originalName,
        type: "function" as const,
        function: {
          name: originalName,
          arguments: JSON.stringify(fc.functionCall.args ?? {}),
        },
      };
    });
  }

  return result;
}
