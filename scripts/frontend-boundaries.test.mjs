import assert from "node:assert/strict";
import test from "node:test";
import { checkBoundarySources } from "./frontend-boundaries.mjs";

const violations = (sources) => checkBoundarySources(sources).map(({ rule }) => rule);

test("route public feature entry passes", () => {
  assert.deepEqual(violations({
    "routes/routes.ts": `import("../features/alpha")`,
    "features/alpha/index.ts": `export { default } from "./pages/Alpha"`,
    "features/alpha/pages/Alpha.tsx": "export default function Alpha() {}",
  }), []);
});

test("route deep feature import fails", () => {
  assert.deepEqual(violations({
    "routes/routes.ts": `import("../features/alpha/pages/Alpha")`,
    "features/alpha/pages/Alpha.tsx": "export default function Alpha() {}",
  }), ["NO_ROUTE_DEEP_IMPORTS"]);
});

test("cross-feature deep import fails", () => {
  assert.deepEqual(violations({
    "features/alpha/pages/A.ts": `import "../../beta/api/private"`,
    "features/beta/api/private.ts": "export const value = 1",
  }), ["NO_CROSS_FEATURE_DEEP_IMPORTS"]);
});

test("explicit cross-feature public import passes", () => {
  assert.deepEqual(violations({
    "features/alpha/pages/A.ts": `import { value } from "../../beta"`,
    "features/beta/index.ts": "export const value = 1",
  }), []);
});

test("shared-to-feature import fails", () => {
  assert.deepEqual(violations({
    "shared/lib/tool.ts": `import "../../features/alpha"`,
    "features/alpha/index.ts": "export const value = 1",
  }), ["NO_SHARED_TO_FEATURE_IMPORTS"]);
});

test("feature-to-shared import passes", () => {
  assert.deepEqual(violations({
    "features/alpha/api/client.ts": `import "../../../shared/lib/http"`,
    "shared/lib/http.ts": "export const value = 1",
  }), []);
});

test("approved feature adapter may import generated contracts", () => {
  assert.deepEqual(violations({
    "features/alpha/api/client.ts": `import type { paths } from "../../../generated/openapi/schema"`,
    "generated/openapi/schema.ts": "export interface paths {}",
  }), []);
});

test("page generated import fails", () => {
  assert.deepEqual(violations({
    "features/alpha/pages/A.ts": `import type { paths } from "../../../generated/openapi/schema"`,
    "generated/openapi/schema.ts": "export interface paths {}",
  }), ["NO_DIRECT_GENERATED_IMPORTS"]);
});

test("generated-to-handwritten import fails", () => {
  assert.deepEqual(violations({
    "generated/openapi/schema.ts": `import "../../shared/types/value"`,
    "shared/types/value.ts": "export type Value = string",
  }), ["NO_GENERATED_TO_HANDWRITTEN_IMPORTS"]);
});

test("runtime two-feature cycle fails", () => {
  const result = violations({
    "features/alpha/index.ts": `import { b } from "../beta"; export const a = b`,
    "features/beta/index.ts": `import { a } from "../alpha"; export const b = a`,
  });
  assert.equal(result.filter((rule) => rule === "NO_NEW_CIRCULAR_FEATURE_DEPENDENCIES").length, 2);
});

test("type-only feature relationship creates no runtime cycle", () => {
  assert.deepEqual(violations({
    "features/alpha/index.ts": `import type { B } from "../beta"; export type A = B`,
    "features/beta/index.ts": `import type { A } from "../alpha"; export type B = A`,
  }), []);
});

test("external package import passes", () => {
  assert.deepEqual(violations({ "features/alpha/index.ts": `import React from "react"` }), []);
});

test("relative import inside one feature passes", () => {
  assert.deepEqual(violations({
    "features/alpha/index.ts": `export { value } from "./api/value"`,
    "features/alpha/api/value.ts": "export const value = 1",
  }), []);
});

test("feature-local tests follow the same cross-feature policy", () => {
  assert.deepEqual(violations({
    "features/alpha/tests/a.test.ts": `import "../../beta/api/private"`,
    "features/beta/api/private.ts": "export const value = 1",
  }), ["NO_CROSS_FEATURE_DEEP_IMPORTS"]);
});

test("violation output identifies importer and target", () => {
  const [violation] = checkBoundarySources({
    "shared/lib/tool.ts": `import "../../features/alpha"`,
    "features/alpha/index.ts": "export const value = 1",
  });
  assert.equal(violation.importer, "shared/lib/tool.ts");
  assert.match(violation.target, /features\/alpha\/index\.ts$/);
});
