import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { docsPages } from '../content-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(docsRoot, '..', '..');
const outputRoot = path.join(docsRoot, 'src', 'content', 'docs');

const checkMode = process.argv.includes('--check');

const normalizePath = (value) => value.split(path.sep).join('/');

const quote = (value) => JSON.stringify(value);

const stripLeadingH1 = (markdown) => {
	const lines = markdown.replace(/^\uFEFF/, '').split('\n');
	let index = 0;
	while (index < lines.length && lines[index].trim() === '') index += 1;
	if (index >= lines.length || !lines[index].startsWith('# ')) {
		throw new Error('Canonical docs must start with a top-level heading');
	}
	const title = lines[index].slice(2).trim();
	index += 1;
	if (index < lines.length && lines[index].trim() === '') index += 1;
	return {
		title,
		body: lines.slice(index).join('\n').replace(/\s+$/, '') + '\n',
	};
};

const buildFrontmatter = (page, title) => {
	const lines = ['---', `title: ${quote(page.title ?? title)}`];
	if (page.description) lines.push(`description: ${quote(page.description)}`);
	if (page.template) lines.push(`template: ${quote(page.template)}`);
	lines.push('---', '');
	return `${lines.join('\n')}`;
};

const sourcePages = new Map();
const slugRoutes = new Map();

for (const page of docsPages) {
	const sourcePath = path.resolve(repoRoot, page.source);
	if (sourcePages.has(sourcePath)) {
		throw new Error(`Duplicate canonical source in docs manifest: ${page.source}`);
	}
	sourcePages.set(sourcePath, page);
	slugRoutes.set(`/${page.slug}`, `/${page.slug}`);
	slugRoutes.set(`/${page.slug}/`, `/${page.slug}`);
	for (const redirect of page.redirects ?? []) {
		const normalized = redirect.replace(/\/+$/, '') || '/';
		slugRoutes.set(normalized, `/${page.slug}`);
		slugRoutes.set(`${normalized}/`, `/${page.slug}`);
	}
}

const splitHref = (href) => {
	const hashIndex = href.indexOf('#');
	const queryIndex = href.indexOf('?');
	let cutIndex = href.length;
	if (hashIndex !== -1) cutIndex = Math.min(cutIndex, hashIndex);
	if (queryIndex !== -1) cutIndex = Math.min(cutIndex, queryIndex);
	return {
		base: href.slice(0, cutIndex),
		suffix: href.slice(cutIndex),
	};
};

const resolveCanonicalRoute = (rawHref, sourcePath) => {
	if (!rawHref || rawHref.startsWith('#')) return rawHref;
	if (/^(mailto:|tel:|javascript:)/i.test(rawHref)) return rawHref;

	const { base, suffix } = splitHref(rawHref);

	if (/^https?:\/\//i.test(base)) {
		try {
			const url = new URL(base);
			if (url.hostname === 'docs.slopai.dev') {
				const normalized = slugRoutes.get(url.pathname.replace(/\/+$/, '') || '/');
				if (normalized) return `${normalized}${suffix}`;
			}
		} catch {
			return rawHref;
		}
		return rawHref;
	}

	if (base.startsWith('/')) {
		const normalized = slugRoutes.get(base.replace(/\/+$/, '') || '/');
		if (normalized) return `${normalized}${suffix}`;

		if (base.endsWith('.md')) {
			const targetSource = path.resolve(repoRoot, base.slice(1));
			const page = sourcePages.get(targetSource);
			if (page) return `/${page.slug}${suffix}`;
		}

		return rawHref;
	}

	const candidate = path.resolve(path.dirname(sourcePath), base);
	const direct = sourcePages.get(candidate);
	if (direct) return `/${direct.slug}${suffix}`;

	if (!path.extname(candidate)) {
		const withMd = sourcePages.get(`${candidate}.md`);
		if (withMd) return `/${withMd.slug}${suffix}`;
		const withIndex = sourcePages.get(path.join(candidate, 'index.md'));
		if (withIndex) return `/${withIndex.slug}${suffix}`;
	}

	return rawHref;
};

const normalizeMarkdown = (markdown, sourcePath) =>
	markdown.replace(/(!?\[[^\]]*]\()([^)]+)(\))/g, (match, prefix, href, suffix) => {
		const normalized = resolveCanonicalRoute(href, sourcePath);
		return `${prefix}${normalized}${suffix}`;
	});

const generatedPages = new Map();

for (const page of docsPages) {
	const sourcePath = path.resolve(repoRoot, page.source);
	const outputPath = normalizePath(page.output);
	const source = fs.readFileSync(sourcePath, 'utf8');
	const { title, body } = stripLeadingH1(source);
	const normalizedBody = normalizeMarkdown(body, sourcePath);
	const content = `${buildFrontmatter(page, title)}${normalizedBody}`;
	generatedPages.set(outputPath, content);
}

const listGeneratedFiles = (rootDir) => {
	if (!fs.existsSync(rootDir)) return [];

	const files = [];

	const walk = (currentDir) => {
		for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
			const fullPath = path.join(currentDir, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
				continue;
			}
			if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
				files.push(normalizePath(path.relative(rootDir, fullPath)));
			}
		}
	};

	walk(rootDir);
	return files.sort();
};

if (checkMode) {
	const actualFiles = new Set(listGeneratedFiles(outputRoot));
	const expectedFiles = new Set(generatedPages.keys());
	const problems = [];

	for (const file of [...expectedFiles].sort()) {
		if (!actualFiles.has(file)) {
			problems.push(`missing generated file: ${file}`);
			continue;
		}
		const actual = fs.readFileSync(path.join(outputRoot, file), 'utf8');
		const expected = generatedPages.get(file);
		if (actual !== expected) problems.push(`stale generated file: ${file}`);
	}

	for (const file of [...actualFiles].sort()) {
		if (!expectedFiles.has(file)) problems.push(`unexpected generated file: ${file}`);
	}

	if (problems.length > 0) {
		for (const problem of problems) console.error(problem);
		process.exit(1);
	}

	process.exit(0);
}

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

for (const [outputPath, content] of [...generatedPages.entries()].sort(([a], [b]) => a.localeCompare(b))) {
	const fullPath = path.join(outputRoot, outputPath);
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, content);
}
