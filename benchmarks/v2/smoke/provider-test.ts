import { OpenAICompatProvider } from "../providers/openai-compat.ts";
import type { ChatMessage, ToolDef } from "../providers/types.ts";

const DGX_URL = process.env.SLOP_DGX_URL ?? "http://slopinator-s-1.local:11434/v1";
const MODEL = process.env.SLOP_SMOKE_MODEL ?? "gemma4:31b";

const tools: ToolDef[] = [
  {
    name: "get_weather",
    description: "Get current weather for a city",
    parameters: {
      type: "object",
      properties: { city: { type: "string", description: "City name" } },
      required: ["city"],
    },
  },
  {
    name: "answer",
    description: "Deliver the final answer to the user once you have enough information",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
];

async function main() {
  const provider = new OpenAICompatProvider({ baseUrl: DGX_URL, model: MODEL });
  console.log(`[smoke] provider=${provider.id} url=${DGX_URL}`);

  const history: ChatMessage[] = [
    { role: "user", content: "What's the weather in Tokyo? Report in one short sentence." },
  ];

  const systemPrompt =
    "You are an assistant that always uses tools when they can help. " +
    "When you have a final answer, call the `answer` tool.";

  let totalInput = 0;
  let totalOutput = 0;
  let turn = 0;
  const MAX_TURNS = 6;
  const t0 = performance.now();

  while (turn < MAX_TURNS) {
    turn += 1;
    const res = await provider.generate({ systemPrompt, messages: history, tools });
    totalInput += res.usage.inputTokens;
    totalOutput += res.usage.outputTokens;

    console.log(
      `[turn ${turn}] finish=${res.finishReason} in=${res.usage.inputTokens} out=${res.usage.outputTokens} latency=${res.rawLatencyMs.toFixed(0)}ms`,
    );

    history.push(res.message);

    if (!res.message.toolCalls || res.message.toolCalls.length === 0) {
      console.log(`[turn ${turn}] assistant: ${res.message.content.slice(0, 200)}`);
      break;
    }

    for (const call of res.message.toolCalls) {
      console.log(`[turn ${turn}] tool_call ${call.name}(${JSON.stringify(call.arguments)})`);
      if (call.name === "answer") {
        console.log(`\nFINAL ANSWER: ${String(call.arguments.text ?? "")}`);
        printSummary(totalInput, totalOutput, t0, turn, true);
        return;
      }
      const result = dispatchTool(call.name, call.arguments);
      history.push({
        role: "tool",
        content: JSON.stringify(result),
        toolCallId: call.id,
        name: call.name,
      });
    }
  }

  printSummary(totalInput, totalOutput, t0, turn, false);
}

function dispatchTool(name: string, args: Record<string, unknown>): unknown {
  if (name === "get_weather") {
    return { city: args.city ?? "unknown", temp_c: 18, conditions: "partly cloudy" };
  }
  return { error: `unknown tool: ${name}` };
}

function printSummary(inTok: number, outTok: number, t0: number, turns: number, answered: boolean) {
  const total = performance.now() - t0;
  console.log("\n--- smoke summary ---");
  console.log(`turns:       ${turns}`);
  console.log(`input tok:   ${inTok}`);
  console.log(`output tok:  ${outTok}`);
  console.log(`total ms:    ${total.toFixed(0)}`);
  console.log(`answered:    ${answered}`);
}

main().catch((err) => {
  console.error("[smoke] failed:", err);
  process.exit(1);
});
