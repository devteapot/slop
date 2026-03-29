let links = [
  {
    id: "1",
    title: "SLOP Protocol",
    url: "https://slopai.dev",
    clicks: 12,
    created: "2024-01-15"
  },
  {
    id: "2",
    title: "Hacker News",
    url: "https://news.ycombinator.com",
    clicks: 25,
    created: "2024-02-01"
  },
  {
    id: "3",
    title: "GitHub",
    url: "https://github.com",
    clicks: 8,
    created: "2024-03-10"
  }
];
const listeners = /* @__PURE__ */ new Set();
function getLinks() {
  return [...links];
}
function addLink(title, url) {
  links.push({
    id: Date.now().toString(),
    title,
    url,
    clicks: 0,
    created: (/* @__PURE__ */ new Date()).toISOString().split("T")[0]
  });
  notify();
}
function deleteLink(id) {
  links = links.filter((l) => l.id !== id);
  notify();
}
function visitLink(id) {
  const link = links.find((l) => l.id === id);
  if (link) {
    link.clicks++;
    notify();
  }
}
function notify() {
  listeners.forEach((fn) => fn());
}
const load = () => {
  return { links: getLinks() };
};
const actions = {
  add: async ({ request }) => {
    const data = await request.formData();
    const title = data.get("title");
    const url = data.get("url");
    if (title && url) {
      addLink(title, url);
    }
  },
  delete: async ({ request }) => {
    const data = await request.formData();
    const id = data.get("id");
    if (id) {
      deleteLink(id);
    }
  },
  visit: async ({ request }) => {
    const data = await request.formData();
    const id = data.get("id");
    if (id) {
      visitLink(id);
    }
  }
};
export {
  actions,
  load
};
