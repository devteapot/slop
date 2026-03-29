import { _ as _export_sfc, v as vueExports, s as serverRenderer_cjs_prodExports } from './server.mjs';
import '../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:crypto';
import 'stream';
import 'events';
import 'http';
import 'crypto';
import 'buffer';
import 'zlib';
import 'https';
import 'net';
import 'tls';
import 'url';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:url';
import '../routes/renderer.mjs';
import 'vue-bundle-renderer/runtime';
import 'vue/server-renderer';
import 'unhead/server';
import 'devalue';
import 'unhead/utils';
import 'vue';
import 'unhead/plugins';
import 'node:stream';

const _sfc_main = /* @__PURE__ */ vueExports.defineComponent({
  __name: "index",
  __ssrInlineRender: true,
  setup(__props) {
    const contacts = vueExports.ref([]);
    const loading = vueExports.ref(true);
    const editingId = vueExports.ref(null);
    const editForm = vueExports.ref({ name: "", email: "", phone: "" });
    const newContact = vueExports.ref({ name: "", email: "", phone: "" });
    const showAddForm = vueExports.ref(false);
    return (_ctx, _push, _parent, _attrs) => {
      _push(`<div${serverRenderer_cjs_prodExports.ssrRenderAttrs(vueExports.mergeProps({ class: "container" }, _attrs))} data-v-594aac2e><header class="header" data-v-594aac2e><div class="header-top" data-v-594aac2e><h1 data-v-594aac2e>Contacts</h1><span class="badge" data-v-594aac2e>${serverRenderer_cjs_prodExports.ssrInterpolate(vueExports.unref(contacts).length)}</span></div><p class="subtitle" data-v-594aac2e> SLOP-powered contacts manager <span class="slop-badge" data-v-594aac2e>SLOP ws://localhost:3000/slop</span></p></header><div class="actions-bar" data-v-594aac2e><button class="btn btn-primary" data-v-594aac2e>${serverRenderer_cjs_prodExports.ssrInterpolate(vueExports.unref(showAddForm) ? "Cancel" : "+ Add Contact")}</button><span class="fav-count" data-v-594aac2e>${serverRenderer_cjs_prodExports.ssrInterpolate(vueExports.unref(contacts).filter((c) => c.favorite).length)} favorite${serverRenderer_cjs_prodExports.ssrInterpolate(vueExports.unref(contacts).filter((c) => c.favorite).length !== 1 ? "s" : "")}</span></div>`);
      if (vueExports.unref(showAddForm)) {
        _push(`<form class="add-form" data-v-594aac2e><h3 data-v-594aac2e>New Contact</h3><div class="form-row" data-v-594aac2e><input${serverRenderer_cjs_prodExports.ssrRenderAttr("value", vueExports.unref(newContact).name)} placeholder="Name *" required class="input" data-v-594aac2e><input${serverRenderer_cjs_prodExports.ssrRenderAttr("value", vueExports.unref(newContact).email)} placeholder="Email *" type="email" required class="input" data-v-594aac2e><input${serverRenderer_cjs_prodExports.ssrRenderAttr("value", vueExports.unref(newContact).phone)} placeholder="Phone" class="input" data-v-594aac2e><button type="submit" class="btn btn-primary" data-v-594aac2e>Add</button></div></form>`);
      } else {
        _push(`<!---->`);
      }
      if (vueExports.unref(loading)) {
        _push(`<div class="loading" data-v-594aac2e>Loading contacts...</div>`);
      } else {
        _push(`<div${serverRenderer_cjs_prodExports.ssrRenderAttrs({
          name: "list",
          class: "contact-list"
        })} data-v-594aac2e>`);
        serverRenderer_cjs_prodExports.ssrRenderList(vueExports.unref(contacts), (contact) => {
          _push(`<div class="${serverRenderer_cjs_prodExports.ssrRenderClass([{ "is-favorite": contact.favorite }, "contact-card"])}" data-v-594aac2e>`);
          if (vueExports.unref(editingId) === contact.id) {
            _push(`<form class="edit-form" data-v-594aac2e><input${serverRenderer_cjs_prodExports.ssrRenderAttr("value", vueExports.unref(editForm).name)} class="input" placeholder="Name" data-v-594aac2e><input${serverRenderer_cjs_prodExports.ssrRenderAttr("value", vueExports.unref(editForm).email)} class="input" placeholder="Email" type="email" data-v-594aac2e><input${serverRenderer_cjs_prodExports.ssrRenderAttr("value", vueExports.unref(editForm).phone)} class="input" placeholder="Phone" data-v-594aac2e><div class="edit-actions" data-v-594aac2e><button type="submit" class="btn btn-small btn-primary" data-v-594aac2e> Save </button><button type="button" class="btn btn-small btn-ghost" data-v-594aac2e> Cancel </button></div></form>`);
          } else {
            _push(`<!--[--><button class="${serverRenderer_cjs_prodExports.ssrRenderClass([{ active: contact.favorite }, "star-btn"])}"${serverRenderer_cjs_prodExports.ssrRenderAttr(
              "title",
              contact.favorite ? "Remove from favorites" : "Add to favorites"
            )} data-v-594aac2e>${serverRenderer_cjs_prodExports.ssrInterpolate(contact.favorite ? "\u2605" : "\u2606")}</button><div class="contact-info" data-v-594aac2e><div class="contact-name" data-v-594aac2e>${serverRenderer_cjs_prodExports.ssrInterpolate(contact.name)}</div><div class="contact-detail" data-v-594aac2e>${serverRenderer_cjs_prodExports.ssrInterpolate(contact.email)}</div>`);
            if (contact.phone) {
              _push(`<div class="contact-detail contact-phone" data-v-594aac2e>${serverRenderer_cjs_prodExports.ssrInterpolate(contact.phone)}</div>`);
            } else {
              _push(`<!---->`);
            }
            _push(`</div><div class="contact-actions" data-v-594aac2e><button class="btn btn-small btn-ghost" data-v-594aac2e> Edit </button><button class="btn btn-small btn-danger" data-v-594aac2e> Delete </button></div><!--]-->`);
          }
          _push(`</div>`);
        });
        _push(`</div>`);
      }
      _push(`<footer class="footer" data-v-594aac2e><p data-v-594aac2e> State is served via WebSocket at <code data-v-594aac2e>/slop</code> using the SLOP protocol. </p></footer></div>`);
    };
  }
});
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = vueExports.useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("pages/index.vue");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["__scopeId", "data-v-594aac2e"]]);

export { index as default };
//# sourceMappingURL=index-C7tcIcCv.mjs.map
