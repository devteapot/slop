import { parseArgs } from "node:util";
import { runSweep } from "./runner/sweep.ts";
import type { SweepConfig } from "./runner/types.ts";

const { values } = parseArgs({
  options: {
    config: { type: "string", default: "smoke" },
    "dry-run": { type: "boolean", default: false },
    fresh: { type: "boolean", default: false },
    id: { type: "string" },
  },
});

const configName = values.config!;
const mod = await import(`./config/${configName}.ts`);
const camel = configName.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const sweepName = `${camel}Sweep`;
const sweep: SweepConfig | undefined = mod[sweepName] ?? mod.default;
if (!sweep) {
  console.error(`config/${configName}.ts must export \`${sweepName}\` or a default SweepConfig`);
  process.exit(1);
}

if (values.id) sweep.id = values.id;

console.log(`[run] sweep=${sweep.id} config=${configName}`);
console.log(
  `[run] providers=${sweep.providers.map((p) => `${p.kind}:${p.model}`).join(",")} ` +
    `prompts=${sweep.promptVariants.join(",")} ` +
    `encodings=${sweep.encodingVariants.join(",")} ` +
    `optimizations=${sweep.optimizationVariants.join(",")} ` +
    `protocols=${sweep.protocols.join(",")} ` +
    `apps=${sweep.apps.join(",")} ` +
    `scales=${sweep.dataScales.join(",")} ` +
    `iterations=${sweep.iterations}`,
);

await runSweep(sweep, { dryRun: values["dry-run"], fresh: values.fresh });
