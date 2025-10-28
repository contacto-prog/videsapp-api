import { searchGooglePrices } from './scrapers/googlePrices.js';

const q = process.argv[2] || 'paracetamol';
const lat = process.env.LAT ? Number(process.env.LAT) : null;
const lng = process.env.LNG ? Number(process.env.LNG) : null;

const r = await searchGooglePrices(q, { lat, lng, headful: process.env.HEADFUL==='1' });
console.log(JSON.stringify(r, null, 2));
