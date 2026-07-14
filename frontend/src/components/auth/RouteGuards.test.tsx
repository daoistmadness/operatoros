import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "../../context/AuthContext";
import { RequireAuth, RequireRole } from "./RouteGuards";

const noop = vi.fn();
const auth = (role?: "admin" | "staff", loading = false): AuthContextValue => ({
  user: role ? { id: 1, username: role, role } : null,
  loading,
  authenticated: Boolean(role),
  login: noop,
  logout: noop,
});
const render = (value: AuthContextValue, node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter><AuthContext.Provider value={value}>{node}</AuthContext.Provider></MemoryRouter>);

describe("authentication route guards", () => {
  it("holds protected content while session bootstrap is loading", () => expect(render(auth(undefined, true), <RequireAuth><span>private</span></RequireAuth>)).toContain("Checking your session"));
  it("renders protected content for an authenticated user", () => expect(render(auth("staff"), <RequireAuth><span>private</span></RequireAuth>)).toContain("private"));
  it("denies the admin area to staff without logging them out", () => expect(render(auth("staff"), <RequireRole role="admin"><span>backup</span></RequireRole>)).toContain("Access denied"));
  it("renders the admin area for administrators", () => expect(render(auth("admin"), <RequireRole role="admin"><span>backup</span></RequireRole>)).toContain("backup"));
});
