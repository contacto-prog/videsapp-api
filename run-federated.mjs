import { federatedSearchTop1 } from "./scrapers/searchFederated.js";
const out = await federatedSearchTop1("paracetamol", { lat: -33.45, lng: -70.66, debug: true, limitPerStore: 10 });
console.log(JSON.stringify(out, null, 2));
