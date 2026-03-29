import { nitroHandler } from "@slop-ai/server/nitro";
import { slop } from "../utils/slop";

export default defineWebSocketHandler(nitroHandler(slop));
