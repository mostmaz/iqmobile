# Asking-price guidance

The posting price step compares the same brand, model, storage, condition and governorate. Model matching ignores case and whitespace, but does not fuzzy-match variants; storage treats 1024GB and 1TB as equivalent. Location means governorate, not neighborhood.

Authenticated GET /listings/price-guidance accepts brand, model, storage, condition and governorate. It uses active listings created in the last 30 days, excludes the caller's ads, hidden price shops, unavailable stock and request-only prices. It follows the existing expiration setting. Prices below the marketplace's 100,000 IQD posting minimum are excluded.

At least three matching listings are required to display median and full min/max range. Counts refer to listings, not unique sellers; duplicates and outliers can affect results. No broader location or different condition is silently substituted. The UI labels these as asking prices, explicitly not completed-sale values or a guaranteed valuation, and never changes or blocks the seller's price.

Validation: 33 server tests and mobile TypeScript passed. Deploy the server endpoint before releasing the mobile update.
