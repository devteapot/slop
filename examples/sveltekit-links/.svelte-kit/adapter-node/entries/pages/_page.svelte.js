import { a as ssr_context, e as escape_html, b as attr_class, c as attr, d as ensure_array_like } from "../../chunks/root.js";
import "@sveltejs/kit/internal";
import "../../chunks/exports.js";
import "../../chunks/utils2.js";
import "@sveltejs/kit/internal/server";
import "../../chunks/state.svelte.js";
function onDestroy(fn) {
  /** @type {SSRContext} */
  ssr_context.r.on_destroy(fn);
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    let connected = false;
    onDestroy(() => {
    });
    let newTitle = "";
    let newUrl = "";
    $$renderer2.push(`<main class="svelte-1uha8ag"><header class="svelte-1uha8ag"><h1 class="svelte-1uha8ag">Links</h1> <p class="subtitle svelte-1uha8ag">${escape_html(data.links.length)} links ·
      ${escape_html(data.links.reduce((s, l) => s + l.clicks, 0))} total clicks <span${attr_class("status svelte-1uha8ag", void 0, { "online": connected })}>${escape_html("SLOP disconnected")}</span></p></header> <section class="add-form svelte-1uha8ag"><h2 class="svelte-1uha8ag">Add Link</h2> <form method="POST" action="?/add"><div class="form-row svelte-1uha8ag"><input type="text" name="title" placeholder="Title" required=""${attr("value", newTitle)} class="svelte-1uha8ag"/> <input type="url" name="url" placeholder="https://example.com" required=""${attr("value", newUrl)} class="svelte-1uha8ag"/> <button type="submit" class="btn btn-add svelte-1uha8ag">Add</button></div></form></section> <section class="links-list svelte-1uha8ag">`);
    const each_array = ensure_array_like(data.links);
    if (each_array.length !== 0) {
      $$renderer2.push("<!--[-->");
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let link = each_array[$$index];
        $$renderer2.push(`<div class="link-card svelte-1uha8ag"><div class="link-info svelte-1uha8ag"><a${attr("href", link.url)} class="link-title svelte-1uha8ag" target="_blank" rel="noopener">${escape_html(link.title)}</a> <span class="link-url svelte-1uha8ag">${escape_html(link.url)}</span> <div class="link-meta svelte-1uha8ag"><span class="clicks">${escape_html(link.clicks)} click${escape_html(link.clicks !== 1 ? "s" : "")}</span> <span class="sep svelte-1uha8ag">·</span> <span class="created">${escape_html(link.created)}</span></div></div> <div class="link-actions svelte-1uha8ag"><form method="POST" action="?/visit"><input type="hidden" name="id"${attr("value", link.id)} class="svelte-1uha8ag"/> <button type="submit" class="btn btn-visit svelte-1uha8ag" title="Track click">+1</button></form> <form method="POST" action="?/delete"><input type="hidden" name="id"${attr("value", link.id)} class="svelte-1uha8ag"/> <button type="submit" class="btn btn-delete svelte-1uha8ag" title="Delete link">×</button></form></div></div>`);
      }
    } else {
      $$renderer2.push("<!--[!-->");
      $$renderer2.push(`<p class="empty svelte-1uha8ag">No links yet. Add one above.</p>`);
    }
    $$renderer2.push(`<!--]--></section> <footer class="svelte-1uha8ag"><p>Powered by <strong class="svelte-1uha8ag">SLOP</strong> — State &amp; Layout Observation Protocol</p></footer></main>`);
  });
}
export {
  _page as default
};
