// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { docsRedirects, docsSidebar } from './content-manifest.mjs';

export default defineConfig({
	site: 'https://docs.slopai.dev',
	redirects: docsRedirects,
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
			sidebar: docsSidebar,
		}),
	],
});
