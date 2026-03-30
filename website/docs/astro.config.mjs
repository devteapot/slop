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
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/devteapot/slop' },
			],
			customCss: ['./src/styles/custom.css'],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Quick Start', slug: 'getting-started' },
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
					],
				},
				{
					label: 'API Reference',
					items: [
						{ label: '@slop-ai/core', slug: 'api/core' },
						{ label: '@slop-ai/react', slug: 'api/react' },
						{ label: '@slop-ai/server', slug: 'api/server' },
						{ label: '@slop-ai/consumer', slug: 'api/consumer' },
					],
				},
				{
					label: 'Protocol Spec',
					autogenerate: { directory: 'spec' },
				},
				{
					label: 'Extension',
					items: [
						{ label: 'Install & Setup', slug: 'extension/install' },
					],
				},
				{
					label: 'Desktop App',
					items: [
						{ label: 'Install & Setup', slug: 'desktop/install' },
					],
				},
			],
		}),
	],
});
