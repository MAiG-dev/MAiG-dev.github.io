#!/usr/bin/env node
/**
 * build-blog.js
 *
 * Converts a markdown blog post → an HTML page, regenerates blog/index.html,
 * and updates sitemap.xml.
 *
 * Usage:
 *   node build-blog.js <post.md> [output-dir]
 *
 *   post.md     — path to the markdown file to convert (required)
 *   output-dir  — directory to write the HTML file into (default: <dev-site>/blog/)
 *
 * Requires: marked  (npm install marked)
 * Everything else is Node built-ins.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── config ──────────────────────────────────────────────────────────────────

const SITE_ROOT  = __dirname;
const BLOG_OUT   = path.join(SITE_ROOT, 'blog');
const SITEMAP    = path.join(SITE_ROOT, 'sitemap.xml');
const SITE_URL   = 'https://maig.dev';
const OG_IMAGE   = `${SITE_URL}/assets/og-image.png`;
const PUBLISHER  = 'Lucky 13 Technologies, LLC';
const GA_ID      = 'G-FPSFGRBXY3';

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help') {
  console.log('Usage: node build-blog.js <post.md> [output-dir]');
  process.exit(args.length === 0 ? 1 : 0);
}

const mdPath  = path.resolve(args[0]);
const outDir  = args[1] ? path.resolve(args[1]) : BLOG_OUT;

// ─── deps ─────────────────────────────────────────────────────────────────────

let marked;
try {
  ({ marked } = require('marked'));
} catch {
  console.error('\nERROR: "marked" is not installed.');
  console.error('Run: npm install marked\n');
  process.exit(1);
}

// Configure marked: GitHub-flavoured markdown, syntax-highlight fences as-is
marked.setOptions({ gfm: true, breaks: false });

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Parse YAML-ish frontmatter between --- delimiters. */
function parseFrontmatter(src) {
  const match = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error('No frontmatter found');

  const raw  = match[1];
  const body = match[2];
  const fm   = {};

  for (const line of raw.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let   val = line.slice(colon + 1).trim();

    // Strip wrapping quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    // Parse arrays: [a, b, c]
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1)
               .split(',')
               .map(v => v.trim().replace(/^["']|["']$/g, ''));
    }

    fm[key] = val;
  }

  return { fm, body };
}

/** Escape HTML entities for attribute values. */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Format a date string (YYYY-MM-DD or Date object) as "Month D, YYYY". */
function fmtDate(d) {
  const months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  const dt = new Date(String(d) + 'T12:00:00Z');
  return `${months[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}`;
}

/** Strip markdown for plain-text excerpts (first ~160 chars). */
function excerpt(mdBody, maxLen = 160) {
  const text = mdBody
    .replace(/^#{1,6}\s+.*/gm, '')   // headings
    .replace(/```[\s\S]*?```/g, '')   // code blocks
    .replace(/`[^`]+`/g, '')          // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/[*_~>#\-]/g, '')        // punctuation
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

// ─── HTML templates ───────────────────────────────────────────────────────────

function postHtml({ fm, contentHtml, postExcerpt }) {
  const slug        = fm.slug;
  const title       = esc(fm.title);
  const description = esc(fm.description || '');
  const dateIso     = String(fm.date);
  const dateFmt     = fmtDate(dateIso);
  const url         = `${SITE_URL}/blog/${slug}.html`;
  const keywords    = Array.isArray(fm.keywords)
                        ? fm.keywords.join(', ')
                        : (fm.keywords || '');
  const tags        = Array.isArray(fm.tags) ? fm.tags : [];

  const schemaKeywords = Array.isArray(fm.keywords)
    ? fm.keywords.map(k => `"${k}"`).join(', ')
    : `"${fm.keywords || ''}"`;

  // Embedded metadata — read back by the index builder when scanning the blog dir
  const meta = JSON.stringify({ slug, title: fm.title, date: dateIso, tags, excerpt: postExcerpt });

  return `<!DOCTYPE html>
<!-- blog-meta: ${meta} -->
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="icon" type="image/svg+xml" href="../assets/favicon.svg"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — MAIG</title>
  <meta name="description" content="${description}" />
  ${keywords ? `<meta name="keywords" content="${esc(keywords)}" />` : ''}
  <link rel="canonical" href="${url}" />
  <!-- Open Graph -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${url}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${OG_IMAGE}" />
  <meta property="article:published_time" content="${dateIso}T00:00:00Z" />
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${OG_IMAGE}" />
  <link rel="stylesheet" href="../assets/style.css" />
  <link rel="stylesheet" href="../assets/blog.css" />
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag("js", new Date());
    gtag("config", "${GA_ID}");
  </script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": ${JSON.stringify(fm.title)},
    "description": ${JSON.stringify(fm.description || '')},
    "datePublished": "${dateIso}",
    "url": "${url}",
    "author": { "@type": "Organization", "name": "${PUBLISHER}" },
    "publisher": { "@type": "Organization", "name": "${PUBLISHER}", "url": "${SITE_URL}" },
    "keywords": [${schemaKeywords}]
  }
  </script>
</head>
<body>
  <header>
    <div class="logo"><a href="../index.html" style="color:inherit;text-decoration:none;">m<span style="color:var(--accent-light)">a</span>ig</a></div>
    <nav>
      <a href="../index.html">Home</a>
      <a href="../blog/index.html">Blog</a>
      <a href="../docs.html">Docs</a>
      <a href="../contact.html">Contact</a>
      <a href="https://app.maig.dev" class="btn btn-sm">Dashboard</a>
    </nav>
    <button class="nav-toggle" aria-label="Toggle navigation" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
  </header>

  <main class="blog-post">
    <article>
      <header class="post-header">
        <div class="post-meta">
          <time datetime="${dateIso}">${dateFmt}</time>
          ${tags.length ? `<span class="post-tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</span>` : ''}
        </div>
        <h1>${title}</h1>
        <p class="post-description">${description}</p>
      </header>
      <div class="post-body">
${contentHtml}
      </div>
    </article>

    <aside class="post-cta">
      <h2>Build AI into your mobile app — free</h2>
      <p>MAIG gives you a secure AI gateway with native iOS and Android SDKs. Free tier: 1,000 requests/month. No credit card required.</p>
      <a href="${SITE_URL}" class="btn">Get started free</a>
    </aside>
  </main>

  <footer>
    <div class="footer-links">
      <a href="../docs.html">Docs</a>
      <a href="../blog/index.html">Blog</a>
      <a href="../privacy.html">Privacy Policy</a>
      <a href="../terms.html">Terms of Service</a>
      <a href="../contact.html">Contact</a>
    </div>
    <div class="footer-copy">&copy; 2014–2026 ${PUBLISHER}. All rights reserved.</div>
  </footer>
  <script src="../assets/nav.js"></script>
</body>
</html>`;
}

function indexHtml(posts) {
  const rows = posts
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .map(p => {
      const dateFmt = fmtDate(p.date);
      const tags    = Array.isArray(p.tags) ? p.tags : [];
      const label   = tags.length ? ` — <span class="tag">${esc(tags[0])}</span>` : '';
      return `    <li class="blog-index-item">
      <time datetime="${p.date}">${dateFmt}</time>${label}
      <a href="${p.slug}.html">${esc(p.title)}</a>
      <p>${esc(p.excerpt)}</p>
    </li>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="icon" type="image/svg+xml" href="../assets/favicon.svg"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Blog — MAIG</title>
  <meta name="description" content="Tutorials, guides, and tips for iOS and Android developers building AI-powered mobile apps with MAIG." />
  <link rel="canonical" href="${SITE_URL}/blog/" />
  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${SITE_URL}/blog/" />
  <meta property="og:title" content="Blog — MAIG" />
  <meta property="og:description" content="Tutorials, guides, and tips for iOS and Android developers building AI-powered mobile apps with MAIG." />
  <meta property="og:image" content="${OG_IMAGE}" />
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Blog — MAIG" />
  <meta name="twitter:description" content="Tutorials, guides, and tips for iOS and Android developers building AI-powered mobile apps with MAIG." />
  <meta name="twitter:image" content="${OG_IMAGE}" />
  <link rel="stylesheet" href="../assets/style.css" />
  <link rel="stylesheet" href="../assets/blog.css" />
</head>
<body>
  <header>
    <div class="logo"><a href="../index.html" style="color:inherit;text-decoration:none;">m<span style="color:var(--accent-light)">a</span>ig</a></div>
    <nav>
      <a href="../index.html">Home</a>
      <a href="../blog/index.html" class="active">Blog</a>
      <a href="../docs.html">Docs</a>
      <a href="../contact.html">Contact</a>
      <a href="https://app.maig.dev" class="btn btn-sm">Dashboard</a>
    </nav>
    <button class="nav-toggle" aria-label="Toggle navigation" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
  </header>

  <main>
    <div class="page-header">
      <h1>Blog</h1>
      <p>Tutorials and guides for iOS and Android developers building AI-powered apps.</p>
    </div>
    <ul class="blog-index-list">
${rows}
    </ul>
  </main>

  <footer>
    <div class="footer-links">
      <a href="../docs.html">Docs</a>
      <a href="../privacy.html">Privacy Policy</a>
      <a href="../terms.html">Terms of Service</a>
      <a href="../contact.html">Contact</a>
    </div>
    <div class="footer-copy">&copy; 2014–2026 ${PUBLISHER}. All rights reserved.</div>
  </footer>
  <script src="../assets/nav.js"></script>
</body>
</html>`;
}

// ─── sitemap update ───────────────────────────────────────────────────────────

function updateSitemap(posts) {
  const existing = fs.readFileSync(SITEMAP, 'utf8');

  // Remove any existing blog/ entries so we can rebuild them cleanly
  const stripped = existing.replace(/\s*<url>\s*<loc>https:\/\/maig\.dev\/blog\/[^<]+<\/loc>[\s\S]*?<\/url>/g, '');

  const blogEntries = posts
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .map(p => `  <url>
    <loc>${SITE_URL}/blog/${p.slug}.html</loc>
    <lastmod>${p.date}</lastmod>
    <priority>0.7</priority>
    <changefreq>monthly</changefreq>
  </url>`)
    .join('\n');

  // Also add the blog index if not present
  const indexEntry = `  <url>
    <loc>${SITE_URL}/blog/</loc>
    <priority>0.8</priority>
    <changefreq>weekly</changefreq>
  </url>`;

  const hasIndex = stripped.includes(`${SITE_URL}/blog/`);

  const updated = stripped.replace(
    '</urlset>',
    `${hasIndex ? '' : indexEntry + '\n'}${blogEntries}\n</urlset>`
  );

  fs.writeFileSync(SITEMAP, updated, 'utf8');
}

// ─── main ─────────────────────────────────────────────────────────────────────

/** Scan the output dir and extract metadata from previously-built post HTML files. */
function readBuiltPosts(dir, excludeSlug) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.html') && f !== 'index.html')
    .flatMap(f => {
      const html = fs.readFileSync(path.join(dir, f), 'utf8');
      const match = html.match(/<!--\s*blog-meta:\s*(\{.*?\})\s*-->/);
      if (!match) return [];
      try {
        const meta = JSON.parse(match[1]);
        if (meta.slug === excludeSlug) return []; // will be replaced by the new build
        return [meta];
      } catch { return []; }
    });
}

function buildPost(mdFilePath, outputDir) {
  if (!fs.existsSync(mdFilePath)) {
    console.error(`File not found: ${mdFilePath}`);
    process.exit(1);
  }

  const src = fs.readFileSync(mdFilePath, 'utf8');
  let fm, body;
  try {
    ({ fm, body } = parseFrontmatter(src));
  } catch (e) {
    console.error(`Error parsing frontmatter: ${e.message}`);
    process.exit(1);
  }

  if (!fm.slug || !fm.title || !fm.date) {
    console.error('Frontmatter is missing required fields: slug, title, date');
    process.exit(1);
  }

  const postExcerpt = excerpt(body);
  const contentHtml = marked.parse(body);
  const html        = postHtml({ fm, contentHtml, postExcerpt });
  const outPath     = path.join(outputDir, `${fm.slug}.html`);

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`  ✓ ${path.relative(SITE_ROOT, outPath)}`);

  return { slug: fm.slug, title: fm.title, date: fm.date, tags: fm.tags || [], excerpt: postExcerpt };
}

function main() {
  console.log('');

  const newPost  = buildPost(mdPath, outDir);
  const existing = readBuiltPosts(outDir, newPost.slug);
  const allPosts = [newPost, ...existing];

  fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml(allPosts), 'utf8');
  console.log(`  ✓ ${path.relative(SITE_ROOT, path.join(outDir, 'index.html'))}`);

  updateSitemap(allPosts);
  console.log('  ✓ sitemap.xml');

  console.log('\nDone.\n');
}

main();
