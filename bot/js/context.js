// Collapses the context lookups back into the single request item (keeps voice binary).
function firstOf(name) {
  try {
    const it = $(name).first();
    return it && it.json ? it : null;
  } catch (e) {
    return null;
  }
}
const src = firstOf('Route') || firstOf('Digest request');
return [{ json: src.json, ...(src.binary ? { binary: src.binary } : {}) }];
