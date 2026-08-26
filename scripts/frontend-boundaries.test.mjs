import { expect, test } from "bun:test";
import { checkBoundarySources } from "./frontend-boundaries.mjs";

const violations = (sources) => checkBoundarySources(sources).map(({ rule }) => rule);

test("route public feature entry passes", () => {
  expect(violations({
    "routes/routes.ts": `import("../features/alpha")`,
    "features/alpha/index.ts": `export { default } from "./pages/Alpha"`,
    "features/alpha/pages/Alpha.tsx": "export default function Alpha() {}",
  })).toEqual([]);
});

test("route deep feature import fails", () => {
  expect(violations({
    "routes/routes.ts": `import("../features/alpha/pages/Alpha")`,
    "features/alpha/pages/Alpha.tsx": "export default function Alpha() {}",
  })).toEqual(["NO_ROUTE_DEEP_IMPORTS"]);
});

test("cross-feature deep import fails", () => {
  expect(violations({
    "features/alpha/pages/A.ts": `import "../../beta/api/private"`,
    "features/beta/api/private.ts": "export const value = 1",
  })).toEqual(["NO_CROSS_FEATURE_DEEP_IMPORTS"]);
});

test("explicit cross-feature public import passes", () => {
  expect(violations({
    "features/alpha/pages/A.ts": `import { value } from "../../beta"`,
    "features/beta/index.ts": "export const value = 1",
  })).toEqual([]);
});

test("shared-to-feature import fails", () => {
  expect(violations({
    "shared/lib/tool.ts": `import "../../features/alpha"`,
    "features/alpha/index.ts": "export const value = 1",
  })).toEqual(["NO_SHARED_TO_FEATURE_IMPORTS"]);
});

test("feature-to-shared import passes", () => {
  expect(violations({
    "features/alpha/api/client.ts": `import "../../../shared/lib/http"`,
    "shared/lib/http.ts": "export const value = 1",
  })).toEqual([]);
});

test("approved feature adapter may import generated contracts", () => {
  expect(violations({
    "features/alpha/api/client.ts": `import type { paths } from "../../../generated/openapi/schema"`,
    "generated/openapi/schema.ts": "export interface paths {}",
  })).toEqual([]);
});

test("page generated import fails", () => {
  expect(violations({
    "features/alpha/pages/A.ts": `import type { paths } from "../../../generated/openapi/schema"`,
    "generated/openapi/schema.ts": "export interface paths {}",
  })).toEqual(["NO_DIRECT_GENERATED_IMPORTS"]);
});

test("generated-to-handwritten import fails", () => {
  expect(violations({
    "generated/openapi/schema.ts": `import "../../shared/types/value"`,
    "shared/types/value.ts": "export type Value = string",
  })).toEqual(["NO_GENERATED_TO_HANDWRITTEN_IMPORTS"]);
});

test("runtime two-feature cycle fails", () => {
  const result = violations({
    "features/alpha/index.ts": `import { b } from "../beta"; export const a = b`,
    "features/beta/index.ts": `import { a } from "../alpha"; export const b = a`,
  });
  expect(result.filter((rule) => rule === "NO_NEW_CIRCULAR_FEATURE_DEPENDENCIES").length).toBe(2);
});

test("type-only feature relationship creates no runtime cycle", () => {
  expect(violations({
    "features/alpha/index.ts": `import type { B } from "../beta"; export type A = B`,
    "features/beta/index.ts": `import type { A } from "../alpha"; export type B = A`,
  })).toEqual([]);
});

test("external package import passes", () => {
  expect(violations({ "features/alpha/index.ts": `import React from "react"` })).toEqual([]);
});

test("relative import inside one feature passes", () => {
  expect(violations({
    "features/alpha/index.ts": `export { value } from "./api/value"`,
    "features/alpha/api/value.ts": "export const value = 1",
  })).toEqual([]);
});

test("feature-local tests follow the same cross-feature policy", () => {
  expect(violations({
    "features/alpha/tests/a.test.ts": `import "../../beta/api/private"`,
    "features/beta/api/private.ts": "export const value = 1",
  })).toEqual(["NO_CROSS_FEATURE_DEEP_IMPORTS"]);
});

test("violation output identifies importer and target", () => {
  const [violation] = checkBoundarySources({
    "shared/lib/tool.ts": `import "../../features/alpha"`,
    "features/alpha/index.ts": "export const value = 1",
  });
  expect(violation.importer).toBe("shared/lib/tool.ts");
  expect(violation.target).toMatch(/features\/alpha\/index\.ts$/);
});
