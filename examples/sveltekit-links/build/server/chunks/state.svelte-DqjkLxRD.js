import { B as noop } from './exports-mboH1FuL.js';
import '@sveltejs/kit/internal/server';

const is_legacy = noop.toString().includes("$$") || /function \w+\(\) \{\}/.test(noop.toString());
const placeholder_url = "a:";
if (is_legacy) {
  ({
    url: new URL(placeholder_url)
  });
}
//# sourceMappingURL=state.svelte-DqjkLxRD.js.map
