// Bundled brand marks for the request funnel's brand grid.
//
// The server is still the authority: `brands.logo_path` wins whenever an
// operator has uploaded one through POST /admin/brands/:id/logo. This map is
// the fallback under it, and the brand's initial is the fallback under that,
// so a brand nobody has a mark for still renders a deliberate-looking card.
//
// Why these ship in the binary, against the earlier note in
// docs/request-funnel.md that they never would: the owner asked for them, and
// with zero of twenty-two logos uploaded the grid was seven letters. The
// earlier reasoning — that trademark use is the operator's call — is answered
// by the override above, not by shipping nothing.
//
// Provenance: Wikimedia Commons / English Wikipedia file pages, at 256px on
// the long edge, alpha-trimmed. Six are tagged public domain (below the
// threshold of originality); Samsung's wordmark is CC BY 4.0. They remain
// manufacturer trademarks and are used here only to identify the brand whose
// phones the listing belongs to.
//
// `require` calls must be literal — Metro resolves them at build time, so a
// computed path silently yields nothing.

const LOGOS: Record<string, number> = {
  apple: require('../../assets/brands/apple.png'),
  samsung: require('../../assets/brands/samsung.png'),
  honor: require('../../assets/brands/honor.png'),
  realme: require('../../assets/brands/realme.png'),
  xiaomi: require('../../assets/brands/xiaomi.png'),
  infinix: require('../../assets/brands/infinix.png'),
  tecno: require('../../assets/brands/tecno.png'),
};

/** The bundled mark for a brand name, or null when there isn't one. */
export function bundledBrandLogo(name: string | null | undefined): number | null {
  const k = String(name ?? '').trim().toLowerCase();
  return LOGOS[k] ?? null;
}
