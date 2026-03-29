import { n as noop } from "./root.js";
import "./exports.js";
import "@sveltejs/kit/internal/server";
const is_legacy = noop.toString().includes("$$") || /function \w+\(\) \{\}/.test(noop.toString());
const placeholder_url = "a:";
if (is_legacy) {
  ({
    data: {},
    form: null,
    error: null,
    params: {},
    route: { id: null },
    state: {},
    status: -1,
    url: new URL(placeholder_url)
  });
}
