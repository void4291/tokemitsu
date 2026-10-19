import { pricingPath } from './paths.js';
import { readJson } from './util.js';

/**
 * USD per million tokens. These are list-price ASSUMPTIONS by model family, not a live feed.
 * Override per model or family in ~/.tokemitsu/pricing.json, e.g.
 *   { "claude-sonnet-5-5": { "in": 3, "out": 15, "cw": 3.75, "cr": 0.3 }, "haiku": { "in": 1, "out": 5 } }
 * For subscription plans this is an API-equivalent value, not what you are billed.
 */
const FAMILIES = {
  opus: { in: 5, out: 25 },
  sonnet: { in: 3, out: 15 },
  haiku: { in: 1, out: 5 },
};
const withCache = (p) => ({ cw: p.in * 1.25, cr: p.in * 0.1, ...p });

export function familyOf(model = '') {
  const m = model.toLowerCase();
  if (/haiku/.test(m)) return 'haiku';
  if (/opus|fable|mythos/.test(m)) return 'opus'; // top tiers: priced like opus unless overridden
  return 'sonnet';
}

export function priceFor(model, overrides = readJson(pricingPath(), {})) {
  const fam = familyOf(model);
  const hit = overrides[model] ?? overrides[fam];
  const base = withCache(FAMILIES[fam]);
  return { ...base, ...(hit ?? {}), family: fam, source: hit ? 'override' : 'default' };
}

export const usd = (tokens, perMillion) => (tokens * perMillion) / 1e6;
