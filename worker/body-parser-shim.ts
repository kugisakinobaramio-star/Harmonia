// Harmonia's API does not read request bodies. Express imports body-parser eagerly,
// but body-parser's iconv-lite dependency uses Node stream APIs unavailable in Workers.
// Keep Express's exported parser symbols present and fail loudly if a future route tries to use them.
function unsupportedBodyParser(): never {
  throw new Error('Request body parsing is not enabled in the Cloudflare Worker adapter.');
}

export const json = unsupportedBodyParser;
export const raw = unsupportedBodyParser;
export const text = unsupportedBodyParser;
export const urlencoded = unsupportedBodyParser;

export default { json, raw, text, urlencoded };
