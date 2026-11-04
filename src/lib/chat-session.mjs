// Chat state for the signed-in browser session. It lives outside the lazily loaded chat panel,
// so signing out can clear it without downloading the panel.
export const SESSION_CHAT_HISTORY = new Map();
// One saved-conversation id per Dive for this browser session; Clear starts a new one.
export const SESSION_CONVERSATIONS = new Map();
// Ratings given in this session, by answer id, so a rating survives the panel remounting.
export const RATINGS = new Map();
let catalogRequest = null;

export function clearChatSession() {
  SESSION_CHAT_HISTORY.clear();
  SESSION_CONVERSATIONS.clear();
  RATINGS.clear();
  catalogRequest = null;
}

// The server decides which tiers exist; the browser only remembers a choice.
export function loadModelCatalog() {
  catalogRequest ??= fetch("/api/chat", { credentials: "same-origin", cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((catalog) => (Array.isArray(catalog?.models) && catalog.models.length ? catalog : null))
    .catch(() => null)
    .then((catalog) => {
      if (!catalog) catalogRequest = null;
      return catalog;
    });
  return catalogRequest;
}
