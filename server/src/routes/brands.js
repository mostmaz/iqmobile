// Public brand catalog — what the mobile BrowseScreen filter rail reads
// to know which brands to show and how many active listings each has.
//
// No auth required: same surface as `/listings` itself. Cached
// client-side (React Query `staleTime: 5 minutes`) and at this layer
// via the brand cache in brands.js.

import { Router } from 'express';
import { getBrandsWithCounts } from '../brands.js';

const r = Router();

r.get('/', (_req, res) => {
  res.json(getBrandsWithCounts());
});

export default r;
