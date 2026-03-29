export interface Link {
  id: string;
  title: string;
  url: string;
  clicks: number;
  created: string;
}

let links: Link[] = [
  {
    id: "1",
    title: "SLOP Protocol",
    url: "https://slopai.dev",
    clicks: 12,
    created: "2024-01-15",
  },
  {
    id: "2",
    title: "Hacker News",
    url: "https://news.ycombinator.com",
    clicks: 25,
    created: "2024-02-01",
  },
  {
    id: "3",
    title: "GitHub",
    url: "https://github.com",
    clicks: 8,
    created: "2024-03-10",
  },
];

let version = 1;
const listeners: Set<() => void> = new Set();

export function getLinks(): Link[] {
  return [...links];
}

export function getVersion(): number {
  return version;
}

export function addLink(title: string, url: string): void {
  links.push({
    id: Date.now().toString(),
    title,
    url,
    clicks: 0,
    created: new Date().toISOString().split("T")[0],
  });
  version++;
  notify();
}

export function deleteLink(id: string): void {
  links = links.filter((l) => l.id !== id);
  version++;
  notify();
}

export function visitLink(id: string): void {
  const link = links.find((l) => l.id === id);
  if (link) {
    link.clicks++;
    version++;
    notify();
  }
}

export function onStateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(): void {
  listeners.forEach((fn) => fn());
}
