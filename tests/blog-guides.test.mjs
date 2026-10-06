import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadSite } from '../scripts/build-site.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const slugs = ['linkedin-network-csv', 'linkedin-connection-degrees', 'linkedin-connections-at-company', 'linkedin-warm-introduction', 'linkedin-network-job-search'];

test('October 5 guides render with accurate article metadata and discoverable links', () => {
  const output = mkdtempSync(path.join(tmpdir(), 'sixgree-blog-test-'));
  try {
    build(root, output, { images: false });
    const read = (relative) => readFileSync(path.join(output, relative), 'utf8');
    for (const slug of slugs) {
      const url = `https://sixgree.com/blog/${slug}/`;
      const html = read(`blog/${slug}/index.html`);
      assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
      assert.match(html, /<h2 id="/, 'Markdown sections follow the article H1 without skipping H2');
      assert.ok(html.includes(`<link rel="canonical" href="${url}">`));
      assert.match(html, /<meta name="description" content="[^"]+">/);
      assert.match(html, /<meta property="og:type" content="article">/);
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
      const graph = blocks.flatMap((b) => b['@graph'] || [b]);
      const article = graph.find((b) => b['@type'] === 'BlogPosting');
      assert.ok(article, 'BlogPosting exists');
      assert.equal(article.datePublished, '2026-10-05');
      assert.equal(article.dateModified, '2026-10-05');
      assert.equal(article.author.name, 'Blake Burford');
      assert.equal(article.url, url);
      assert.ok(existsSync(path.join(output, new URL(article.image).pathname)));
      assert.match(html, /not affiliated with LinkedIn/);
      for (const discovery of ['blog/index.html', 'blog/feed.xml', 'sitemap.xml', 'llms.txt']) {
        assert.ok(read(discovery).includes(`/blog/${slug}/`), `${discovery} discovers ${slug}`);
      }
      for (const match of html.matchAll(/href="(\/[^"?#]*)(?:[?#][^"]*)?"/g)) {
        const address = match[1];
        const target = path.join(output, address.endsWith('/') ? `${address}index.html` : address);
        assert.ok(existsSync(target), `internal link exists: ${address}`);
      }
    }
    for (const post of loadSite(root).posts.slice(0, 3)) {
      assert.ok(read('index.html').includes(post.path), `homepage discovers latest post: ${post.slug}`);
    }
    assert.ok(!existsSync(path.join(output, '_posts')), 'Markdown sources not published');
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
