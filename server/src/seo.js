// The bits of the public web pages that exist for crawlers rather than
// people: canonical host, structured data, robots and sitemaps.
//
// Audited 24 Sep 2026 against the live site and three things were wrong in
// ways that cost traffic rather than merely missing an opportunity:
//
//   1. Every page canonicalised to https://api.iqmobile.org — PUBLIC_BASE_URL
//      is unset in production and that was the default. The pages are served
//      on BOTH hosts, so the site was telling Google the brand domain is a
//      duplicate of the API subdomain and to index the API instead.
//   2. No robots.txt and no sitemap.xml, both 404. ~4,000 live listings with
//      nothing pointing at them.
//   3. No structured data anywhere. For a marketplace that is the difference
//      between a blue link and a result carrying a price and availability.
//
// Kept in one module because all three answers depend on the same question —
// which URL is the real one — and that question was previously answered
// three different ways in three files.

/**
 * The host the public site actually lives on.
 *
 * Defaults to the BRAND domain, not the API host. A wrong value here is not
 * a cosmetic bug: it is a rel=canonical pointing somewhere else, which is an
 * instruction to de-index this page in favour of that one.
 */
export const SITE_URL = (process.env.PUBLIC_BASE_URL || 'https://iqmobile.org').replace(/\/+$/, '');

/**
 * Where uploaded images are served from.
 *
 * Deliberately separate from SITE_URL: the pages moved to the brand domain
 * but the files are still served by the API, and pointing <img> at a host
 * that does not have them would break every photo on the site to fix a
 * canonical tag.
 */
export const MEDIA_URL = (process.env.PUBLIC_MEDIA_URL || process.env.PUBLIC_BASE_URL || 'https://api.iqmobile.org').replace(/\/+$/, '');

/** Hosts that must never be indexed, whatever they are asked for. */
const NOINDEX_HOSTS = new Set(['api.iqmobile.org']);

/**
 * Should this request's host be crawled?
 *
 * The API subdomain serves the same HTML as the brand domain — it is the
 * same Express app — so without this it competes with iqmobile.org for every
 * page. robots.txt answers per host, which is the only place this can be
 * settled: one app, two names.
 */
export function hostIsIndexable(hostname) {
  return !NOINDEX_HOSTS.has(String(hostname || '').toLowerCase());
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** JSON-LD, escaped for a <script> block. */
export function jsonLd(obj) {
  // </script> inside a JSON string would close the block early; the
  // forward-slash escape is valid JSON and defuses it.
  const json = JSON.stringify(obj).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

/** schema.org condition for our four stored values. */
const CONDITION = {
  new: 'https://schema.org/NewCondition',
  used: 'https://schema.org/UsedCondition',
  refurbished: 'https://schema.org/RefurbishedCondition',
  repaired: 'https://schema.org/RefurbishedCondition',
};

/**
 * Product + Offer for one listing.
 *
 * `itemCondition` is the field that matters most here and the one a generic
 * e-commerce snippet leaves out: almost everything on this site is used, and
 * a used phone presented as new is both wrong and a policy problem.
 *
 * A call-for-price listing (asking_price <= 1, the sentinel) gets NO Offer
 * rather than an Offer of 1 dinar. An invented price in structured data is
 * the kind of thing that costs a rich-result eligibility, not just a click.
 */
export function listingJsonLd(l, { images = [], sellerName = null } = {}) {
  const priced = Number(l.asking_price) > 1 && !l.price_on_request;
  const availability = l.status === 'sold' ? 'https://schema.org/SoldOut'
    : l.status === 'reserved' ? 'https://schema.org/LimitedAvailability'
      : 'https://schema.org/InStock';

  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: [l.brand, l.model, l.storage].filter(Boolean).join(' '),
    description: l.description || [l.brand, l.model, l.storage, l.color].filter(Boolean).join(' · '),
    sku: `iq-${l.id}`,
    url: `${SITE_URL}/l/${l.id}`,
    ...(l.brand ? { brand: { '@type': 'Brand', name: l.brand } } : {}),
    ...(images.length ? { image: images } : {}),
    ...(l.color ? { color: l.color } : {}),
  };
  if (priced) {
    product.offers = {
      '@type': 'Offer',
      price: Number(l.asking_price),
      priceCurrency: 'IQD',
      availability,
      itemCondition: CONDITION[l.condition] || CONDITION.used,
      url: `${SITE_URL}/l/${l.id}`,
      ...(sellerName ? { seller: { '@type': 'Organization', name: sellerName } } : {}),
    };
  }
  return product;
}

/** Store schema for a shop page. */
export function shopJsonLd(u, { logo = null, listingCount = 0 } = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: u.shop_name || u.display_name,
    url: `${SITE_URL}/shop/${u.id}`,
    ...(logo ? { image: logo } : {}),
    ...(u.governorate ? {
      address: { '@type': 'PostalAddress', addressRegion: u.governorate, addressCountry: 'IQ' },
    } : {}),
    ...(Number(u.rating_count) > 0 ? {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: Number(u.rating_avg).toFixed(1),
        reviewCount: Number(u.rating_count),
      },
    } : {}),
    ...(listingCount ? { makesOffer: { '@type': 'Offer', itemOffered: { '@type': 'Product', name: `${listingCount} جهاز` } } } : {}),
  };
}

/** Breadcrumbs — cheap, and they change how the URL itself renders in results. */
export function breadcrumbJsonLd(trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem', position: i + 1, name: t.name, item: t.url,
    })),
  };
}

export { esc as escapeHtml };
