export type ArchitectureFixture = {
  name: string;
  sourcePackage: string;
  source: string;
  manifestDependencies?: Record<string, string>;
  expected: "pass" | "fail";
};

export const architectureFixtures: ArchitectureFixture[] = [
  { name: "contracts rejects Elysia", sourcePackage: "@operatoros/contracts", source: 'import "elysia";', expected: "fail" },
  { name: "contracts rejects Drizzle", sourcePackage: "@operatoros/contracts", source: 'import "drizzle-orm";', expected: "fail" },
  { name: "contracts rejects React", sourcePackage: "@operatoros/contracts", source: 'import "react";', expected: "fail" },
  { name: "web rejects DB", sourcePackage: "@operatoros/web", source: 'import "@operatoros/db";', expected: "fail" },
  { name: "web rejects Drizzle", sourcePackage: "@operatoros/web", source: 'import "drizzle-orm";', expected: "fail" },
  { name: "web rejects API", sourcePackage: "@operatoros/web", source: 'import "@operatoros/api";', expected: "fail" },
  { name: "UI rejects app source", sourcePackage: "@operatoros/ui", source: 'import "apps/web/src/App";', expected: "fail" },
  { name: "UI rejects DB", sourcePackage: "@operatoros/ui", source: 'import "@operatoros/db";', expected: "fail" },
  { name: "UI rejects contracts", sourcePackage: "@operatoros/ui", source: 'import "@operatoros/contracts";', expected: "fail" },
  { name: "DB rejects app source", sourcePackage: "@operatoros/db", source: 'import "apps/api/src/app";', expected: "fail" },
  { name: "DB rejects contracts", sourcePackage: "@operatoros/db", source: 'import "@operatoros/contracts";', expected: "fail" },
  { name: "deep workspace import rejects", sourcePackage: "@operatoros/web", source: 'import "@operatoros/ui/src/components/button";', expected: "fail" },
  { name: "cross-workspace relative import rejects", sourcePackage: "@operatoros/web", source: 'import "../../../packages/db/src/schema";', expected: "fail" },
  { name: "type-only edge rejects", sourcePackage: "@operatoros/web", source: 'import type { Database } from "@operatoros/db";', expected: "fail" },
  { name: "re-export edge rejects", sourcePackage: "@operatoros/contracts", source: 'export * from "elysia";', expected: "fail" },
  { name: "dynamic import edge rejects", sourcePackage: "@operatoros/web", source: 'await import("@operatoros/db");', expected: "fail" },
  { name: "require edge rejects", sourcePackage: "@operatoros/web", source: 'const db = require("@operatoros/db");', expected: "fail" },
  { name: "unexported subpath rejects", sourcePackage: "@operatoros/web", source: 'import "@operatoros/ui/internal";', expected: "fail" },
  { name: "manifest edge rejects", sourcePackage: "@operatoros/web", source: "export const value = 1;", manifestDependencies: { "@operatoros/db": "workspace:*" }, expected: "fail" },
  { name: "API may consume contracts", sourcePackage: "@operatoros/api", source: 'import "@operatoros/contracts";', expected: "pass" },
  { name: "API may consume DB", sourcePackage: "@operatoros/api", source: 'import "@operatoros/db";', expected: "pass" },
  { name: "web may consume contracts", sourcePackage: "@operatoros/web", source: 'import "@operatoros/contracts";', expected: "pass" },
  { name: "web may consume UI export", sourcePackage: "@operatoros/web", source: 'import "@operatoros/ui/components/button";', expected: "pass" },
  { name: "UI may consume React", sourcePackage: "@operatoros/ui", source: 'import "react";', expected: "pass" },
  { name: "contracts may consume TypeBox", sourcePackage: "@operatoros/contracts", source: 'import { Type } from "@sinclair/typebox";', expected: "pass" },
  { name: "DB may consume Drizzle", sourcePackage: "@operatoros/db", source: 'import { sql } from "drizzle-orm";', expected: "pass" },
  { name: "Excel may consume contracts", sourcePackage: "@operatoros/excel", source: 'import "@operatoros/contracts";', expected: "pass" },
  { name: "Excel rejects DB", sourcePackage: "@operatoros/excel", source: 'import "@operatoros/db";', expected: "fail" },
  { name: "Excel rejects UI", sourcePackage: "@operatoros/excel", source: 'import "@operatoros/ui";', expected: "fail" },
  { name: "Excel rejects API", sourcePackage: "@operatoros/excel", source: 'import "@operatoros/api";', expected: "fail" },
  { name: "Excel rejects Elysia", sourcePackage: "@operatoros/excel", source: 'import "elysia";', expected: "fail" },
];
