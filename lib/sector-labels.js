// Each pick's label, colour, industry and kind, for pages that only name a
// pick (the profile's "Your Sectors"). The sector directory
// (lib/sector-directory.js) holds the same labels beside its word lists, which
// make it about 100 KB; a page that names a pick loads this instead.
// tests/sector-directory.test.mjs checks that the two agree.

import { INDUSTRIES, UNKNOWN_INDUSTRY } from './companies.js';

// The directory's sectors: key → [label, the industry it sits under, kind].
const SECTORS = {
  software: ['Software & SaaS', 'tech', 'function'],
  'ai-data': ['AI & Data', 'tech', 'function'],
  cybersecurity: ['Cybersecurity', 'tech', 'function'],
  telecom: ['Telecom', 'tech', 'industry'],
  fintech: ['Fintech & Payments', 'finance', 'industry'],
  banking: ['Banking & Lending', 'finance', 'industry'],
  'vc-pe': ['Venture Capital & Private Equity', 'finance', 'industry'],
  wealth: ['Wealth & Asset Management', 'finance', 'industry'],
  insurance: ['Insurance', 'finance', 'industry'],
  accounting: ['Accounting & Tax', 'finance', 'function'],
  crypto: ['Crypto & Web3', 'finance', 'industry'],
  hospitals: ['Hospitals & Clinics', 'health', 'industry'],
  dental: ['Dental', 'health', 'industry'],
  'pharma-biotech': ['Pharma & Biotech', 'health', 'industry'],
  'medical-devices': ['Medical Devices', 'health', 'industry'],
  'mental-health': ['Mental Health', 'health', 'industry'],
  'fitness-wellness': ['Fitness & Wellness', 'health', 'industry'],
  veterinary: ['Veterinary & Animal Care', 'health', 'industry'],
  k12: ['K-12 Education', 'education', 'industry'],
  'higher-ed': ['Higher Education', 'education', 'industry'],
  'marketing-advertising': ['Marketing & Advertising', 'media', 'function'],
  'pr-comms': ['PR & Communications', 'media', 'function'],
  'media-publishing': ['Media & Publishing', 'media', 'industry'],
  'creator-economy': ['Creator Economy', 'media', 'industry'],
  'film-tv-music': ['Film, TV & Music', 'entertainment', 'industry'],
  'gaming-esports': ['Gaming & Esports', 'entertainment', 'industry'],
  sports: ['Sports', 'entertainment', 'industry'],
  'ecommerce-retail': ['E-commerce & Retail', 'consumer', 'industry'],
  'consumer-goods': ['Consumer Goods', 'consumer', 'industry'],
  restaurants: ['Restaurants & Food Service', 'consumer', 'industry'],
  'hospitality-travel': ['Hospitality & Travel', 'consumer', 'industry'],
  'beauty-personal-care': ['Beauty & Personal Care', 'consumer', 'industry'],
  logistics: ['Logistics & Supply Chain', 'industry', 'industry'],
  manufacturing: ['Manufacturing', 'industry', 'industry'],
  energy: ['Energy & Utilities', 'industry', 'industry'],
  automotive: ['Automotive', 'industry', 'industry'],
  agriculture: ['Agriculture & Farming', 'industry', 'industry'],
  'aerospace-defense': ['Aerospace & Defense', 'defense', 'industry'],
  military: ['Military', 'defense', 'industry'],
  government: ['Government & Public Sector', 'defense', 'industry'],
  legal: ['Legal', 'consulting', 'function'],
  'management-consulting': ['Management Consulting', 'consulting', 'function'],
  'hr-recruiting': ['HR & Recruiting', 'consulting', 'function'],
  'security-services': ['Security Services', 'consulting', 'function'],
  'real-estate': ['Real Estate', 'realestate', 'industry'],
  'construction-trades': ['Construction & Trades', 'realestate', 'industry'],
  charities: ['Nonprofits & Charities', 'nonprofit', 'industry'],
  'social-work': ['Social Work & Human Services', 'nonprofit', 'industry'],
  faith: ['Faith & Ministry', 'nonprofit', 'industry'],
};

const COLOR = new Map(INDUSTRIES.map((g) => [g.key, g.color]));

const BY_KEY = new Map([
  ...INDUSTRIES.map((g) => [g.key, Object.freeze({ key: g.key, label: g.label, color: g.color, group: g.key, kind: 'industry' })]),
  ...Object.entries(SECTORS).map(([key, [label, group, kind]]) => [key, Object.freeze({
    key, label, color: COLOR.get(group) || UNKNOWN_INDUSTRY.color, group, kind,
  })]),
]);

/**
 * A pick's label and colour, for a broad industry or a directory sector, with
 * the industry it sits under and its kind: 'function' for a directory sector
 * of work every company has (HR & Recruiting, Legal…), else 'industry'.
 */
export function sectorByKey(key) {
  return BY_KEY.get(key) || { key, label: UNKNOWN_INDUSTRY.label, color: UNKNOWN_INDUSTRY.color, group: null, kind: null };
}

/** A pick's label, or nothing for a key that isn't one. */
export const sectorLabel = (key) => BY_KEY.get(key)?.label;
