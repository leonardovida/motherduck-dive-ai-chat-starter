# API route adapters

The route files keep the existing Node-style handlers in `api/` as the source of truth. `runLegacyHandler` adapts a Next `Request` into the small request/response interface those handlers use, then returns a native `Response` without changing their auth, origin, cookie, cache, or error behavior.

New server routes should use the same checks from `lib/security.mjs` directly: call `authenticated(requestLike)` before protected work, require `sameOrigin(requestLike)` for browser mutations, and return private no-store responses. The legacy adapter is intentionally limited to the existing handlers; it does not add authentication or broaden their scopes.
