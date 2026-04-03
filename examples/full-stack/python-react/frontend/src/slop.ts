import { createSlop } from "@slop-ai/client";

export const slop = createSlop({
  id: "contacts-ui",
  name: "Contacts UI",
  transports: ["websocket"],
  websocketUrl: "ws://localhost:8000/slop?slop_role=provider&mount=ui",
  websocketDiscover: false,
});
