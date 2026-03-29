function Layout($$renderer, $$props) {
  let { children } = $$props;
  children($$renderer);
  $$renderer.push(`<!---->`);
}

export { Layout as default };
//# sourceMappingURL=layout.svelte-UxsTmhKc.js.map
