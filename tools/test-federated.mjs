import { federatedSearchTop1 } from "../scrapers/searchFederated.js";
const run = async () => {
  const r = await federatedSearchTop1({ name: "paracetamol 500", lat: -33.45, lng: -70.66 });
  console.log(Array.isArray(r) ? r.slice(0,3) : r);
};
run().catch(console.error);
