// robots.txt and the sitemaps.
//
// Both were 404 until 24 Sep 2026, so ~4,000 live listings had nothing
// pointing at them and every crawler was guessing.
//
// The sitemap deliberately carries ONLY listings a buyer can still act on.
// A classifieds site whose sitemap lists everything it has ever had teaches
// the crawler that most of what it is offered is gone — the crawl budget
// goes on tombstones and the fresh listings wait. Sold, reserved, expired
// and draft rows are all left out, and the pages themselves carry noindex
// once they are no longer live (see webListing.js).

import { Router } from 'express';
import { db } from '../db.js';
import { SITE_URL, hostIsIndexable } from '../seo.js';

const r = Router();

// Sitemaps cap at 50,000 URLs and 50MB. We are far under, but a marketplace
// grows and discovering the cap by breaking is a bad way to learn it.
const PER_FILE = 20000;

const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
const iso = (ms) => new Date(Number(ms) || Date.now()).toISOString();

r.get('/robots.txt', (req, res) => {
  res.type('text/plain');

  // The API subdomain serves this same Express app, so without a per-host
  // answer it offers Google a complete duplicate of the site under a second
  // name. This is the only place that can be settled.
  if (!hostIsIndexable(req.hostname)) {
    return res.send('User-agent: *\nDisallow: /\n');
  }

  res.send([
    'User-agent: *',
    'Allow: /',
    // Nothing here is useful to a crawler and some of it is per-user.
    'Disallow: /api/',
    'Disallow: /admin',
    'Disallow: /uploads/tmp/',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n'));
});

/** The index — one child per type, so a listings refresh does not re-submit shops. */
r.get('/sitemap.xml', (req, res) => {
  const listings = db.prepare(
    "SELECT COUNT(*) AS n FROM phone_listings WHERE status='active' AND COALESCE(is_draft,0)=0",
  ).get().n;
  const pages = Math.max(1, Math.ceil(listings / PER_FILE));

  const children = [`${SITE_URL}/sitemap-shops.xml`];
  for (let i = 1; i <= pages; i++) children.push(`${SITE_URL}/sitemap-listings-${i}.xml`);

  res.type('application/xml').send(
    `${xmlHeader}\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + children.map((loc) => `<sitemap><loc>${loc}</loc></sitemap>`).join('\n')
    + '\n</sitemapindex>\n',
  );
});

r.get('/sitemap-listings-:page(\\d+).xml', (req, res) => {
  const page = Math.max(1, Number(req.params.page));
  const rows = db.prepare(
    `SELECT id, updated_at FROM phone_listings
      WHERE status='active' AND COALESCE(is_draft,0)=0
      ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
  ).all(PER_FILE, (page - 1) * PER_FILE);

  res.type('application/xml').send(
    `${xmlHeader}\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + rows.map((l) => `<url><loc>${SITE_URL}/l/${l.id}</loc>`
      + `<lastmod>${iso(l.updated_at)}</lastmod>`
      // Listings change when the seller edits or the price moves; daily is
      // an honest guess and a wrong one here costs nothing.
      + '<changefreq>daily</changefreq></url>').join('\n')
    + '\n</urlset>\n',
  );
});

r.get('/sitemap-shops.xml', (req, res) => {
  // Hidden shops are the price aggregator and the storefront — excluded from
  // browse for the same reason they are excluded here.
  const rows = db.prepare(
    `SELECT id FROM users
      WHERE seller_type='shop' AND COALESCE(is_guest,0)=0
        AND COALESCE(shop_hidden,0)=0
        AND COALESCE(shop_status,'approved')='approved'`,
  ).all();

  res.type('application/xml').send(
    `${xmlHeader}\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + [`<url><loc>${SITE_URL}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>`]
      .concat(rows.map((u) => `<url><loc>${SITE_URL}/shop/${u.id}</loc><changefreq>weekly</changefreq></url>`))
      .join('\n')
    + '\n</urlset>\n',
  );
});

export default r;
