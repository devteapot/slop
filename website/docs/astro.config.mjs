// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://docs.slopai.dev',
	integrations: [
		starlight({
			title: 'SLOP',
			logo: {
				src: './src/assets/logo.svg',
			},
			favicon: '/favicon.svg',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/devteapot/slop' },
			],
			customCss: ['./src/styles/custom.css'],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Quick Start', slug: 'getting-started' },
						{ label: 'Playground', link: 'https://playground.slopai.dev', attrs: { target: '_blank' } },
						{ label: 'Interactive Demo', link: 'https://demo.slopai.dev', attrs: { target: '_blank' } },
						{ label: 'Installation', slug: 'getting-started/installation' },
					],
				},
				{
					label: 'Framework Guides',
					items: [
						{ label: 'React', slug: 'guides/react' },
						{ label: 'Vue', slug: 'guides/vue' },
						{ label: 'SolidJS', slug: 'guides/solid' },
						{ label: 'Angular', slug: 'guides/angular' },
						{ label: 'Svelte', slug: 'guides/svelte' },
						{ label: 'Vanilla JS', slug: 'guides/vanilla' },
						{ label: 'Server & Native Apps', slug: 'guides/server-apps' },
						{ label: 'TanStack Start', slug: 'guides/tanstack-start' },
						{ label: 'Python', slug: 'guides/python' },
						{ label: 'Go', slug: 'guides/go' },
						{ label: 'Rust', slug: 'guides/rust' },
						{ label: 'Consumer / Testing', slug: 'guides/consumer' },
					],
				},
				{
					label: 'API Reference',
					items: [
						{ label: 'Package Overview', slug: 'api' },
						{ label: '@slop-ai/core', slug: 'api/core' },
						{ label: '@slop-ai/client', slug: 'api/client' },
						{ label: '@slop-ai/react', slug: 'api/react' },
						{ label: '@slop-ai/vue', slug: 'api/vue' },
						{ label: '@slop-ai/solid', slug: 'api/solid' },
						{ label: '@slop-ai/angular', slug: 'api/angular' },
						{ label: '@slop-ai/svelte', slug: 'api/svelte' },
						{ label: '@slop-ai/server', slug: 'api/server' },
						{ label: '@slop-ai/consumer', slug: 'api/consumer' },
						{ label: '@slop-ai/tanstack-start', slug: 'api/tanstack-start' },
						{ label: '@slop-ai/openclaw-plugin', slug: 'api/openclaw-plugin' },
						{ label: 'slop-ai (Python)', slug: 'api/python' },
						{ label: 'slop-ai (Go)', slug: 'api/go' },
						{ label: 'slop-ai (Rust)', slug: 'api/rust' },
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
						{ label: 'Development & Debugging', slug: 'sdk/development' },
						{ label: 'Sessions & Multi-User', slug: 'sdk/sessions' },
					],
				},
				{
					label: 'Advanced Guides',
					items: [
						{ label: 'Agent-Assisted Integration', slug: 'guides-advanced/agent-scaffolding' },
						{ label: 'OpenClaw Integration', slug: 'guides-advanced/openclaw' },
						{ label: 'Benchmarks: MCP vs SLOP', slug: 'guides-advanced/benchmarks' },
					],
				},
				{
					label: 'Status',
					items: [
						{ label: 'Known Limitations & Future Work', slug: 'spec/limitations' },
					],
				},
				{
					label: 'Consumers',
					items: [
						{ label: 'Overview & CLI', slug: 'guides/consumer' },
						{ label: 'Desktop App', slug: 'desktop/install' },
						{ label: 'Chrome Extension', slug: 'extension/install' },
					],
				},
			],
		}),
	],
});
