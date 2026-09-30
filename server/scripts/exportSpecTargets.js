// Every distinct (brand, model) on live listings, with how many listings
// carry it and whether the iQ store (#5587) or the price shop (#2548) sells
// it — the input to tools/gsmarena/gsm_match.py.
//
//   node scripts/exportSpecTargets.js > ../tools/gsmarena/targets.json
//
// Accessories are left out: there is no spec sheet for a pencil, and the
// matcher would only report them as gaps.
import 'dotenv/config';
import { db } from '../src/db.js';

const rows = db.prepare(`
  SELECT brand, TRIM(model) AS model, COUNT(*) AS n,
         SUM(CASE WHEN seller_id=5587 THEN 1 ELSE 0 END) AS iq,
         SUM(CASE WHEN seller_id=2548 THEN 1 ELSE 0 END) AS price
    FROM phone_listings
   WHERE status IN ('active','reserved') AND COALESCE(product_type,'') <> 'accessory'
   GROUP BY brand, TRIM(model)
   ORDER BY n DESC, brand, model`).all();
process.stdout.write(JSON.stringify(rows));
