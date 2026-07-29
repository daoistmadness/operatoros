# Frontend architecture

Frontend source is TypeScript with a route-level lazy-loading foundation. The
observed baseline is 34 routes and 30 lazy route modules; this is an observation
rather than a compatibility contract. Features retain ownership boundaries and
are migrated incrementally, not through a big-bang reorganization.

TanStack Query owns server state and the sanitized API-error foundation handles
client-facing failures. Generated OpenAPI contracts are version-controlled and
drift-checked, but pages consume feature APIs rather than generated code
directly. Canonical browser routes are `/api/<domain>/...` through the shared
client. See the historical [frontend boundaries](../product-audit/FRONTEND_FEATURE_BOUNDARIES.md) and [OpenAPI foundation](../product-audit/OPENAPI_CLIENT_FOUNDATION.md).
