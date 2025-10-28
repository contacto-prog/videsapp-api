import { searchGooglePricesLite } from './scrapers/googleLite.js';

const q = process.argv[2] || 'paracetamol';
const lat = process.env.LAT ? Number(process.env.LAT) : null;
const lng = process.env.LNG ? Number(process.env.LNG) : null;

const r = await searchGooglePricesLite(q, { lat, lng });
console.log(JSON.stringify(r, null, 2));
