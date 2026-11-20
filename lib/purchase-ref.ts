/** A short reference for a purchase ("PMH-3F2A9C1E"), for the buyer to quote and for us to find it. Safe in the browser. */
export const purchaseRef = (id: string) => `PMH-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
