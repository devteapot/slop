const page = (source, output, options = {}) => ({
	source,
	output,
	slug: output.replace(/\/index\.md$/, '').replace(/\.md$/, ''),
	redirects: [],
	...options,
});

export const docsPages = [
	page('docs/getting-started/index.md', 'getting-started/index.md', {
		label: 'Quick Start',
		description: 'Add SLOP to your app in 5 minutes',
	}),
	page('docs/getting-started/installation.md', 'getting-started/installation.md', {
		label: 'Installation',
		description: 'Install the right SLOP package for your app, agent, or tool',
	}),

	page('docs/guides/react.md', 'guides/react.md', {
		label: 'React',
		description: 'How to use SLOP with React to expose component state to AI agents.',
	}),
	page('docs/guides/vue.md', 'guides/vue.md', {
		label: 'Vue',
		description: 'How to use SLOP with Vue to expose component state to AI agents.',
	}),
	page('docs/guides/solid.md', 'guides/solid.md', {
		label: 'SolidJS',
		description: 'How to use SLOP with SolidJS to expose component state to AI agents.',
	}),
	page('docs/guides/angular.md', 'guides/angular.md', {
		label: 'Angular',
		description: 'How to use SLOP with Angular to expose component state to AI agents.',
	}),
	page('docs/guides/svelte.md', 'guides/svelte.md', {
		label: 'Svelte',
		description: 'How to use SLOP with Svelte 5 to expose component state to AI agents',
	}),
	page('docs/guides/vanilla.md', 'guides/vanilla.md', {
		label: 'Vanilla JS',
		description: 'How to use SLOP with plain JavaScript or TypeScript without a framework.',
	}),
	page('docs/guides/server-apps.md', 'guides/server-apps.md', {
		label: 'Server & Native Apps',
		description: 'Add SLOP to server-backed apps, desktop helpers, daemons, and CLI tools',
	}),
	page('docs/guides/tanstack-start.md', 'guides/tanstack-start.md', {
		label: 'TanStack Start',
		description: 'Use SLOP in TanStack Start with server state plus mounted UI state',
	}),
	page('docs/guides/python.md', 'guides/python.md', {
		label: 'Python',
		description: 'Add SLOP to Python apps with FastAPI, local transports, and consumer tooling',
	}),
	page('docs/guides/go.md', 'guides/go.md', {
		label: 'Go',
		description: 'Add SLOP to Go services, daemons, CLI tools, and consumer workflows',
	}),
	page('docs/guides/rust.md', 'guides/rust.md', {
		label: 'Rust',
		description: 'Add SLOP to Rust apps — axum, CLI tools, daemons, WASM-ready',
	}),
	page('docs/guides/consumer.md', 'guides/consumer.md', {
		label: 'Consumer / Testing',
		description: 'Tools and SDKs for connecting to, inspecting, and testing SLOP providers',
	}),

	page('docs/guides/advanced/agent-scaffolding.md', 'guides/advanced/agent-scaffolding.md', {
		label: 'Agent-Assisted Integration',
		redirects: ['/guides-advanced/agent-scaffolding'],
	}),
	page('docs/guides/advanced/openclaw.md', 'guides/advanced/openclaw.md', {
		label: 'OpenClaw Integration',
		description: 'Control SLOP-enabled applications through OpenClaw',
		redirects: ['/guides-advanced/openclaw'],
	}),
	page('docs/guides/advanced/benchmarks.md', 'guides/advanced/benchmarks.md', {
		label: 'Benchmarks: MCP vs SLOP',
		redirects: ['/guides-advanced/benchmarks'],
	}),

	page('docs/api/index.md', 'api/index.md', {
		label: 'Package Overview',
		description: 'Published SLOP SDKs, adapters, and integration packages',
	}),
	page('docs/api/core.md', 'api/core.md', {
		label: '@slop-ai/core',
		description: 'Shared SLOP descriptor types, helpers, and tree utilities',
	}),
	page('docs/api/client.md', 'api/client.md', {
		label: '@slop-ai/client',
		description: 'Browser-side SLOP provider for SPAs and in-page integrations',
	}),
	page('docs/api/react.md', 'api/react.md', {
		label: '@slop-ai/react',
		description: 'React hook for registering SLOP state from components',
	}),
	page('docs/api/vue.md', 'api/vue.md', {
		label: '@slop-ai/vue',
		description: 'Vue composable for registering SLOP state from reactive components',
	}),
	page('docs/api/solid.md', 'api/solid.md', {
		label: '@slop-ai/solid',
		description: 'SolidJS primitive for registering SLOP state from signals',
	}),
	page('docs/api/angular.md', 'api/angular.md', {
		label: '@slop-ai/angular',
		description: 'Angular integration for exposing signal-based component state through SLOP',
	}),
	page('docs/api/svelte.md', 'api/svelte.md', {
		label: '@slop-ai/svelte',
		description: 'Svelte 5 composable for publishing rune-based state through SLOP',
	}),
	page('docs/api/server.md', 'api/server.md', {
		label: '@slop-ai/server',
		description: 'Server-side SLOP provider for Node.js, Bun, local tools, and native apps',
	}),
	page('docs/api/consumer.md', 'api/consumer.md', {
		label: '@slop-ai/consumer',
		description: 'Consumer SDK for connecting to providers, mirroring state, and invoking actions',
	}),
	page('docs/api/tanstack-start.md', 'api/tanstack-start.md', {
		label: '@slop-ai/tanstack-start',
		description: 'Full-stack SLOP adapter for TanStack Start applications',
	}),
	page('docs/api/openclaw-plugin.md', 'api/openclaw-plugin.md', {
		label: '@slop-ai/openclaw-plugin',
		description: 'OpenClaw plugin for discovering and controlling SLOP-enabled applications',
	}),
	page('docs/api/python.md', 'api/python.md', {
		label: 'slop-ai (Python)',
		description: 'Python package reference for SLOP providers, consumers, and transports',
	}),
	page('docs/api/go.md', 'api/go.md', {
		label: 'slop-ai (Go)',
		description: 'Go package reference for SLOP providers, consumers, and local transports',
	}),
	page('docs/api/rust.md', 'api/rust.md', {
		label: 'slop-ai (Rust)',
		description: 'Rust crate reference for SLOP providers, consumers, and transport features',
	}),

	page('spec/core/overview.md', 'spec/core/overview.md'),
	page('spec/core/state-tree.md', 'spec/core/state-tree.md'),
	page('spec/core/transport.md', 'spec/core/transport.md'),
	page('spec/core/messages.md', 'spec/core/messages.md'),
	page('spec/core/affordances.md', 'spec/core/affordances.md'),
	page('spec/core/attention.md', 'spec/core/attention.md'),
	page('spec/extensions/scaling.md', 'spec/extensions/scaling.md'),
	page('spec/extensions/content-references.md', 'spec/extensions/content-references.md'),
	page('spec/extensions/async-actions.md', 'spec/extensions/async-actions.md'),
	page('spec/integrations/adapters.md', 'spec/integrations/adapters.md'),
	page('spec/integrations/web.md', 'spec/integrations/web.md'),
	page('spec/integrations/desktop.md', 'spec/integrations/desktop.md'),
	page('spec/limitations.md', 'spec/limitations.md', {
		label: 'Known Limitations & Future Work',
	}),

	page('docs/sdk/index.md', 'sdk/index.md', {
		label: 'Overview',
	}),
	page('docs/sdk/development.md', 'sdk/development.md', {
		label: 'Development & Debugging',
	}),
	page('docs/sdk/sessions.md', 'sdk/sessions.md', {
		label: 'Sessions & Multi-User',
	}),

	page('docs/desktop/install.md', 'desktop/install.md', {
		label: 'Desktop App',
		description: 'Build and use the SLOP desktop app',
	}),
	page('docs/extension/install.md', 'extension/install.md', {
		label: 'Chrome Extension',
		description: 'Build and use the SLOP browser extension',
	}),
	page('docs/extension/privacy.md', 'extension/privacy.md', {
		label: 'Chrome Extension Privacy Policy',
		description: 'Privacy policy for the SLOP Chrome extension',
	}),
];

const docsPageBySlug = new Map(docsPages.map((page) => [page.slug, page]));

const pageItem = (slug, label) => ({
	label: label ?? docsPageBySlug.get(slug)?.label ?? slug,
	slug,
});

export const docsSidebar = [
	{
		label: 'Getting Started',
		items: [
			pageItem('getting-started', 'Quick Start'),
			{ label: 'Playground', link: 'https://playground.slopai.dev', attrs: { target: '_blank' } },
			{ label: 'Interactive Demo', link: 'https://demo.slopai.dev', attrs: { target: '_blank' } },
			pageItem('getting-started/installation', 'Installation'),
		],
	},
	{
		label: 'Framework Guides',
		items: [
			pageItem('guides/react'),
			pageItem('guides/vue'),
			pageItem('guides/solid', 'SolidJS'),
			pageItem('guides/angular'),
			pageItem('guides/svelte'),
			pageItem('guides/vanilla', 'Vanilla JS'),
			pageItem('guides/server-apps', 'Server & Native Apps'),
			pageItem('guides/tanstack-start', 'TanStack Start'),
			pageItem('guides/python'),
			pageItem('guides/go', 'Go'),
			pageItem('guides/rust', 'Rust'),
			pageItem('guides/consumer', 'Consumer / Testing'),
		],
	},
	{
		label: 'API Reference',
		items: [
			pageItem('api', 'Package Overview'),
			pageItem('api/core'),
			pageItem('api/client'),
			pageItem('api/react'),
			pageItem('api/vue'),
			pageItem('api/solid'),
			pageItem('api/angular'),
			pageItem('api/svelte'),
			pageItem('api/server'),
			pageItem('api/consumer'),
			pageItem('api/tanstack-start'),
			pageItem('api/openclaw-plugin'),
			pageItem('api/python', 'slop-ai (Python)'),
			pageItem('api/go', 'slop-ai (Go)'),
			pageItem('api/rust', 'slop-ai (Rust)'),
		],
	},
	{
		label: 'Core Protocol',
		autogenerate: { directory: 'spec/core' },
	},
	{
		label: 'Extensions',
		autogenerate: { directory: 'spec/extensions' },
	},
	{
		label: 'Integration Guides',
		autogenerate: { directory: 'spec/integrations' },
	},
	{
		label: 'SDK Architecture',
		items: [
			pageItem('sdk', 'Overview'),
			pageItem('sdk/development'),
			pageItem('sdk/sessions'),
		],
	},
	{
		label: 'Advanced Guides',
		items: [
			pageItem('guides/advanced/agent-scaffolding', 'Agent-Assisted Integration'),
			pageItem('guides/advanced/openclaw', 'OpenClaw Integration'),
			pageItem('guides/advanced/benchmarks', 'Benchmarks: MCP vs SLOP'),
		],
	},
	{
		label: 'Status',
		items: [pageItem('spec/limitations', 'Known Limitations & Future Work')],
	},
	{
		label: 'Consumers',
		items: [
			pageItem('guides/consumer', 'Consumer Guide'),
			pageItem('desktop/install', 'Desktop App'),
			pageItem('extension/install', 'Chrome Extension'),
			pageItem('extension/privacy', 'Extension Privacy Policy'),
		],
	},
];

const withTrailingSlash = (slug) => `/${slug.replace(/^\/+|\/+$/g, '')}/`;

export const docsRedirects = docsPages.reduce(
	(redirects, page) => {
		for (const from of page.redirects) {
			redirects[from.replace(/\/+$/, '') || '/'] = withTrailingSlash(page.slug);
		}
		return redirects;
	},
	{
		'/': '/getting-started/',
	}
);
