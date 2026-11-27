import type { Elysia } from "elysia";
import type { AuthContext, CurrentUser } from "../auth/service";
import { actor } from "./core";
import type { SqliteClient, SqliteBinding } from "@operatoros/db";
import {
  AssetQuery,
  CreateAssetRequest,
  BatchCreateAssetRequest,
  UpdateAssetRequest,
  RetireAssetRequest,
  LabelPrintRequest,
  LabelCalibrationRequest,
  InventoryMasterDataResponse,
  CreateAssetCategoryRequest,
  CreateFundingSourceRequest,
  UpdateInventoryMasterEntryRequest,
  ReorderInventoryMasterEntriesRequest,
  getLabelTemplate,
  getRegisteredLabelTemplates,
  paginateLabelItems,
  validateCalibrationOffsets,
  type AssetDtoType,
  type AssetCategoryDto,
  type FundingSourceDto,
  type AssetConditionDto,
  type AssetStatusDto,
} from "@operatoros/contracts/inventory";
import { randomUUID } from "node:crypto";
import {
  generateAssetLabelsPdf,
  generateCalibrationPdf,
  type LabelAssetItem,
} from "./inventory-labels";
import {
  createWorkbook,
  addWorksheet,
  appendRow,
  appendRows,
  styleHeader,
  autoSizeColumns,
  writeXlsxWorkbook,
  XLSX_MIME_TYPE,
  safeExportFilename,
} from "@operatoros/excel";

type Row = Record<string, any>;
type Context = any;

function inTransaction<T>(db: SqliteClient, fn: () => T): T {
  db.run("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.run("COMMIT");
    return result;
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
}

function deriveSchoolUnitPrefix(name: string): string {
  const upper = name.toUpperCase().trim();
  if (upper.includes("SD")) return "SD";
  if (upper.includes("SMP")) return "SMP";
  if (upper.includes("SMA")) return "SMA";
  if (upper.includes("SMK")) return "SMK";
  if (upper.includes("TK")) return "TK";
  const cleaned = upper.replace(/[^A-Z0-9]/g, "");
  return cleaned.slice(0, 4) || "ASET";
}

function allocateSequences(
  client: SqliteClient,
  unitId: number,
  category: string,
  count: number,
): number[] {
  const row = client
    .query(
      "SELECT last_sequence FROM inventory_asset_sequences WHERE school_unit_id = ? AND category = ?",
    )
    .get(unitId, category) as { last_sequence: number } | null;

  const current = row ? Number(row.last_sequence) : 0;
  const start = current + 1;
  const end = current + count;

  if (!row) {
    client.run(
      "INSERT INTO inventory_asset_sequences (school_unit_id, category, last_sequence) VALUES (?, ?, ?)",
      [unitId, category, end],
    );
  } else {
    client.run(
      "UPDATE inventory_asset_sequences SET last_sequence = ? WHERE school_unit_id = ? AND category = ?",
      [end, unitId, category],
    );
  }

  const result: number[] = [];
  for (let s = start; s <= end; s++) {
    result.push(s);
  }
  return result;
}

function audit(
  db: SqliteClient,
  user: CurrentUser,
  operation: string,
  reference: string,
  changedFields: string[],
  metadata: Record<string, any>,
  capability: string = "manage_inventory",
  riskLevel: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM",
  entityType: string = "INVENTORY_ASSET",
) {
  try {
    db.run(
      `INSERT INTO operations_audit_events
        (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, success, changed_fields, metadata, schema_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'API', 1, ?, ?, '1')`,
      [
        randomUUID(),
        user.username,
        user.role,
        capability,
        entityType,
        reference,
        operation,
        riskLevel,
        JSON.stringify(changedFields),
        JSON.stringify(metadata),
      ],
    );
  } catch (err) {
    console.error("[INVENTORY_AUDIT_ERROR]", err);
  }
}

function normalizeMasterName(value: string): { displayName: string; normalizedName: string } | null {
  const displayName = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!displayName || displayName.length > 80) return null;
  return { displayName, normalizedName: displayName.toLowerCase() };
}

function isUniqueConstraintError(error: unknown): boolean {
  return String((error as { message?: unknown })?.message ?? error).includes("UNIQUE constraint failed");
}

function masterRows(db: SqliteClient, table: "inventory_asset_categories" | "inventory_funding_sources") {
  const referenceSql = table === "inventory_asset_categories"
    ? "EXISTS (SELECT 1 FROM inventory_assets a WHERE a.category = m.code) OR EXISTS (SELECT 1 FROM inventory_asset_sequences s WHERE s.category = m.code)"
    : "EXISTS (SELECT 1 FROM inventory_assets a WHERE a.funding_source = m.code)";
  return db.query(
    `SELECT m.code, m.display_name AS name, m.is_active, m.sort_order,
            NOT (${referenceSql}) AS can_delete
       FROM ${table} m
      ORDER BY m.sort_order, m.display_name COLLATE NOCASE, m.code`,
  ).all() as Array<{ code: string; name: string; is_active: number; sort_order: number; can_delete: number }>;
}

function masterDto(row: { code: string; name: string; is_active: number; sort_order: number; can_delete: number }) {
  return {
    code: String(row.code),
    name: String(row.name),
    is_active: Boolean(row.is_active),
    sort_order: Number(row.sort_order),
    can_delete: Boolean(row.can_delete),
  };
}

function requireActiveMaster(
  db: SqliteClient,
  table: "inventory_asset_categories" | "inventory_funding_sources",
  code: string,
  currentCode?: string,
): string {
  const row = db.query(`SELECT display_name, is_active FROM ${table} WHERE code = ?`).get(code) as { display_name: string; is_active: number } | null;
  if (!row || (!row.is_active && code !== currentCode)) {
    throw new Error(table === "inventory_asset_categories" ? "CATEGORY_NOT_ACTIVE" : "FUNDING_SOURCE_NOT_ACTIVE");
  }
  return String(row.display_name);
}

function inactiveMasterError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error);
  return message === "CATEGORY_NOT_ACTIVE" || message === "FUNDING_SOURCE_NOT_ACTIVE";
}

function mapRowToAssetDto(row: Row): AssetDtoType {
  return {
    id: String(row.id),
    asset_code: String(row.asset_code),
    school_unit_id: Number(row.school_unit_id),
    school_unit_name: String(row.school_unit_name || ""),
    current_unit_id: row.current_unit_id != null ? Number(row.current_unit_id) : Number(row.school_unit_id),
    current_unit_name: row.current_unit_name ? String(row.current_unit_name) : String(row.school_unit_name || ""),
    category: row.category as AssetCategoryDto,
    category_name: String(row.category_name || row.category),
    item_name: String(row.item_name),
    brand: row.brand ? String(row.brand) : null,
    model: row.model ? String(row.model) : null,
    serial_number: row.serial_number ? String(row.serial_number) : null,
    location: row.location ? String(row.location) : null,
    funding_source: row.funding_source as FundingSourceDto,
    funding_source_name: String(row.funding_source_name || row.funding_source),
    budget_year: Number(row.budget_year),
    arkas_account_code: row.arkas_account_code ? String(row.arkas_account_code) : null,
    purchase_document_reference: row.purchase_document_reference ? String(row.purchase_document_reference) : null,
    acquisition_date: row.acquisition_date ? String(row.acquisition_date) : null,
    price: row.price != null ? Number(row.price) : null,
    condition: row.condition as AssetConditionDto,
    status: row.status as AssetStatusDto,
    retired_at: row.retired_at ? String(row.retired_at) : null,
    retired_reason: row.retired_reason ? String(row.retired_reason) : null,
    notes: row.notes ? String(row.notes) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function inventoryRoutes(app: any, context: AuthContext) {
  app.get("/api/inventory/master-data", ({ set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_inventory" });
    if (!user) return { detail: "Authentication required" };

    const db = context.database.client;
    return {
      categories: masterRows(db, "inventory_asset_categories").map(masterDto),
      funding_sources: masterRows(db, "inventory_funding_sources").map(masterDto),
    };
  }, { response: InventoryMasterDataResponse });

  app.post("/api/inventory/master-data/categories", ({ body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "manage_inventory" });
    if (!user) return { detail: "Insufficient permissions" };

    const name = normalizeMasterName(body.name);
    if (!name) {
      set.status = 400;
      return { detail: "Category name must contain 1 to 80 characters" };
    }

    const db = context.database.client;
    try {
      let created: ReturnType<typeof masterDto> | null = null;
      inTransaction(db, () => {
        const order = db.query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM inventory_asset_categories").get() as { next_order: number };
        db.run(
          "INSERT INTO inventory_asset_categories (code, display_name, normalized_name, sort_order) VALUES (?, ?, ?, ?)",
          [body.code, name.displayName, name.normalizedName, order.next_order],
        );
        audit(db, user, "CREATE_ASSET_CATEGORY", body.code, ["code", "display_name"], { display_name: name.displayName }, "manage_inventory", "LOW", "INVENTORY_ASSET_CATEGORY");
        created = { code: body.code, name: name.displayName, is_active: true, sort_order: order.next_order, can_delete: true };
      });
      set.status = 201;
      return created;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        set.status = 409;
        return { detail: "Category code or normalized name already exists" };
      }
      throw error;
    }
  }, { body: CreateAssetCategoryRequest });

  app.post("/api/inventory/master-data/funding-sources", ({ body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "manage_inventory" });
    if (!user) return { detail: "Insufficient permissions" };

    const name = normalizeMasterName(body.name);
    if (!name) {
      set.status = 400;
      return { detail: "Funding source name must contain 1 to 80 characters" };
    }

    const db = context.database.client;
    const code = `CUSTOM_${randomUUID().replace(/-/g, "").toUpperCase()}`;
    try {
      let created: ReturnType<typeof masterDto> | null = null;
      inTransaction(db, () => {
        const order = db.query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM inventory_funding_sources").get() as { next_order: number };
        db.run(
          "INSERT INTO inventory_funding_sources (code, display_name, normalized_name, sort_order) VALUES (?, ?, ?, ?)",
          [code, name.displayName, name.normalizedName, order.next_order],
        );
        audit(db, user, "CREATE_FUNDING_SOURCE", code, ["code", "display_name"], { display_name: name.displayName }, "manage_inventory", "LOW", "INVENTORY_FUNDING_SOURCE");
        created = { code, name: name.displayName, is_active: true, sort_order: order.next_order, can_delete: true };
      });
      set.status = 201;
      return created;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        set.status = 409;
        return { detail: "Funding source name already exists" };
      }
      throw error;
    }
  }, { body: CreateFundingSourceRequest });

  app.patch("/api/inventory/master-data/categories/:code", ({ params, body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "manage_inventory" });
    if (!user) return { detail: "Insufficient permissions" };
    if (body.name === undefined && body.is_active === undefined) {
      set.status = 400;
      return { detail: "At least one category field must be provided" };
    }
    const name = body.name === undefined ? undefined : normalizeMasterName(body.name);
    if (body.name !== undefined && !name) {
      set.status = 400;
      return { detail: "Category name must contain 1 to 80 characters" };
    }
    const db = context.database.client;
    try {
      let updated: ReturnType<typeof masterDto> | null = null;
      inTransaction(db, () => {
        const before = db.query("SELECT code, display_name AS name, is_active, sort_order FROM inventory_asset_categories WHERE code = ?").get(params.code) as Row | null;
        if (!before) throw new Error("MASTER_ENTRY_NOT_FOUND");
        const displayName = name?.displayName ?? String(before.name);
        const normalizedName = name?.normalizedName ?? displayName.toLowerCase();
        const isActive = body.is_active ?? Boolean(before.is_active);
        db.run(
          `UPDATE inventory_asset_categories
           SET display_name = ?, normalized_name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
           WHERE code = ?`,
          [displayName, normalizedName, Number(isActive), params.code],
        );
        const changedFields = [
          ...(name ? ["display_name"] : []),
          ...(body.is_active !== undefined ? ["is_active"] : []),
        ];
        audit(
          db,
          user,
          "UPDATE_ASSET_CATEGORY",
          params.code,
          changedFields,
          {
            before: { display_name: before.name, is_active: Boolean(before.is_active) },
            after: { display_name: displayName, is_active: isActive },
          },
          "manage_inventory",
          "LOW",
          "INVENTORY_ASSET_CATEGORY",
        );
        const row = masterRows(db, "inventory_asset_categories").find((item) => item.code === params.code)!;
        updated = masterDto(row);
      });
      return updated;
    } catch (error) {
      if (String((error as Error).message) === "MASTER_ENTRY_NOT_FOUND") {
        set.status = 404;
        return { detail: "Category not found" };
      }
      if (isUniqueConstraintError(error)) {
        set.status = 409;
        return { detail: "Category name already exists" };
      }
      throw error;
    }
  }, { body: UpdateInventoryMasterEntryRequest });

  app.patch("/api/inventory/master-data/funding-sources/:code", ({ params, body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "manage_inventory" });
    if (!user) return { detail: "Insufficient permissions" };
    if (body.name === undefined && body.is_active === undefined) {
      set.status = 400;
      return { detail: "At least one funding source field must be provided" };
    }
    const name = body.name === undefined ? undefined : normalizeMasterName(body.name);
    if (body.name !== undefined && !name) {
      set.status = 400;
      return { detail: "Funding source name must contain 1 to 80 characters" };
    }
    const db = context.database.client;
    try {
      let updated: ReturnType<typeof masterDto> | null = null;
      inTransaction(db, () => {
        const before = db.query("SELECT code, display_name AS name, is_active, sort_order FROM inventory_funding_sources WHERE code = ?").get(params.code) as Row | null;
        if (!before) throw new Error("MASTER_ENTRY_NOT_FOUND");
        const displayName = name?.displayName ?? String(before.name);
        const normalizedName = name?.normalizedName ?? displayName.toLowerCase();
        const isActive = body.is_active ?? Boolean(before.is_active);
        db.run(
          `UPDATE inventory_funding_sources
           SET display_name = ?, normalized_name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
           WHERE code = ?`,
          [displayName, normalizedName, Number(isActive), params.code],
        );
        const changedFields = [
          ...(name ? ["display_name"] : []),
          ...(body.is_active !== undefined ? ["is_active"] : []),
        ];
        audit(
          db,
          user,
          "UPDATE_FUNDING_SOURCE",
          params.code,
          changedFields,
          {
            before: { display_name: before.name, is_active: Boolean(before.is_active) },
            after: { display_name: displayName, is_active: isActive },
          },
          "manage_inventory",
          "LOW",
          "INVENTORY_FUNDING_SOURCE",
        );
        const row = masterRows(db, "inventory_funding_sources").find((item) => item.code === params.code)!;
        updated = masterDto(row);
      });
      return updated;
    } catch (error) {
      if (String((error as Error).message) === "MASTER_ENTRY_NOT_FOUND") {
        set.status = 404;
        return { detail: "Funding source not found" };
      }
      if (isUniqueConstraintError(error)) {
        set.status = 409;
        return { detail: "Funding source name already exists" };
      }
      throw error;
    }
  }, { body: UpdateInventoryMasterEntryRequest });

  app.put("/api/inventory/master-data/categories/order", ({ body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "manage_inventory" });
    if (!user) return { detail: "Insufficient permissions" };
    const db = context.database.client;
    let invalidOrder = false;
    inTransaction(db, () => {
      const current = masterRows(db, "inventory_asset_categories");
      if (new Set(body.codes).size !== body.codes.length || body.codes.length !== current.length || current.some((item) => !body.codes.includes(item.code))) {
        invalidOrder = true;
        return;
      }
      body.codes.forEach((code: string, index: number) => db.run(
        "UPDATE inventory_asset_categories SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?",
        [index, code],
      ));
      audit(db, user, "REORDER_ASSET_CATEGORIES", "ALL", ["sort_order"], { codes: body.codes }, "manage_inventory", "LOW", "INVENTORY_ASSET_CATEGORY");
    });
    if (invalidOrder) {
      set.status = 400;
      return { detail: "Category order must contain every current code exactly once" };
    }
    return { categories: masterRows(db, "inventory_asset_categories").map(masterDto) };
  }, { body: ReorderInventoryMasterEntriesRequest });

  app.put("/api/inventory/master-data/funding-sources/order", ({ body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "manage_inventory" });
    if (!user) return { detail: "Insufficient permissions" };
    const db = context.database.client;
    let invalidOrder = false;
    inTransaction(db, () => {
      const current = masterRows(db, "inventory_funding_sources");
      if (new Set(body.codes).size !== body.codes.length || body.codes.length !== current.length || current.some((item) => !body.codes.includes(item.code))) {
        invalidOrder = true;
        return;
      }
      body.codes.forEach((code: string, index: number) => db.run(
        "UPDATE inventory_funding_sources SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?",
        [index, code],
      ));
      audit(db, user, "REORDER_FUNDING_SOURCES", "ALL", ["sort_order"], { codes: body.codes }, "manage_inventory", "LOW", "INVENTORY_FUNDING_SOURCE");
    });
    if (invalidOrder) {
      set.status = 400;
      return { detail: "Funding source order must contain every current code exactly once" };
    }
    return { funding_sources: masterRows(db, "inventory_funding_sources").map(masterDto) };
  }, { body: ReorderInventoryMasterEntriesRequest });

  app.delete("/api/inventory/master-data/categories/:code", ({ params, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "manage_inventory" });
    if (!user) return { detail: "Insufficient permissions" };
    const db = context.database.client;
    let conflict = false;
    inTransaction(db, () => {
      const row = db.query("SELECT code, display_name FROM inventory_asset_categories WHERE code = ?").get(params.code) as Row | null;
      if (!row) { set.status = 404; return; }
      const refs = db.query(
        `SELECT EXISTS (SELECT 1 FROM inventory_assets WHERE category = ?)
           OR EXISTS (SELECT 1 FROM inventory_asset_sequences WHERE category = ?) AS referenced`,
      ).get(params.code, params.code) as { referenced: number };
      if (refs.referenced) { conflict = true; return; }
      audit(db, user, "DELETE_ASSET_CATEGORY", params.code, ["code", "display_name"], { display_name: row.display_name }, "manage_inventory", "LOW", "INVENTORY_ASSET_CATEGORY");
      db.run("DELETE FROM inventory_asset_categories WHERE code = ?", [params.code]);
    });
    if (set.status === 404) return { detail: "Category not found" };
    if (conflict) { set.status = 409; return { detail: "Category has asset or sequence history and cannot be deleted" }; }
    set.status = 204;
    return null;
  });

  app.delete("/api/inventory/master-data/funding-sources/:code", ({ params, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "manage_inventory" });
    if (!user) return { detail: "Insufficient permissions" };
    const db = context.database.client;
    let conflict = false;
    inTransaction(db, () => {
      const row = db.query("SELECT code, display_name FROM inventory_funding_sources WHERE code = ?").get(params.code) as Row | null;
      if (!row) { set.status = 404; return; }
      const refs = db.query("SELECT EXISTS (SELECT 1 FROM inventory_assets WHERE funding_source = ?) AS referenced").get(params.code) as { referenced: number };
      if (refs.referenced) { conflict = true; return; }
      audit(db, user, "DELETE_FUNDING_SOURCE", params.code, ["code", "display_name"], { display_name: row.display_name }, "manage_inventory", "LOW", "INVENTORY_FUNDING_SOURCE");
      db.run("DELETE FROM inventory_funding_sources WHERE code = ?", [params.code]);
    });
    if (set.status === 404) return { detail: "Funding source not found" };
    if (conflict) { set.status = 409; return { detail: "Funding source is referenced by assets and cannot be deleted" }; }
    set.status = 204;
    return null;
  });

  // Summary statistics
  app.get("/api/inventory/summary", ({ query, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_inventory" });
    if (!user) return { detail: "Authentication required" };

    const db = context.database.client;
    const conditions: string[] = ["1=1"];
    const params: SqliteBinding[] = [];

    if (query.school_unit_id) {
      conditions.push("(a.school_unit_id = ? OR a.current_unit_id = ?)");
      params.push(Number(query.school_unit_id), Number(query.school_unit_id));
    }
    if (query.funding_source) {
      conditions.push("a.funding_source = ?");
      params.push(String(query.funding_source));
    }
    if (query.budget_year) {
      conditions.push("a.budget_year = ?");
      params.push(Number(query.budget_year));
    }

    const whereClause = conditions.join(" AND ");

    const totalRow = db.query(
      `SELECT 
         COUNT(*) AS total_assets,
         COALESCE(SUM(CASE WHEN price IS NOT NULL THEN price ELSE 0 END), 0) AS total_value,
         SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_count,
         SUM(CASE WHEN status = 'RETIRED' THEN 1 ELSE 0 END) AS retired_count,
         SUM(CASE WHEN condition = 'BAIK' THEN 1 ELSE 0 END) AS baik_count,
         SUM(CASE WHEN condition = 'RUSAK_RINGAN' THEN 1 ELSE 0 END) AS rusak_ringan_count,
         SUM(CASE WHEN condition = 'RUSAK_BERAT' THEN 1 ELSE 0 END) AS rusak_berat_count
       FROM inventory_assets a
       WHERE ${whereClause}`,
    ).get(...params) as any;

    const categoryRows = db.query(
      `SELECT a.category, c.display_name AS category_name, COUNT(*) AS count
       FROM inventory_assets a
       JOIN inventory_asset_categories c ON c.code = a.category
       WHERE ${whereClause}
       GROUP BY a.category, c.display_name`,
    ).all(...params) as { category: string; category_name: string; count: number }[];

    const fundingRows = db.query(
      `SELECT a.funding_source, f.display_name AS funding_source_name, COUNT(*) AS count
       FROM inventory_assets a
       JOIN inventory_funding_sources f ON f.code = a.funding_source
       WHERE ${whereClause}
       GROUP BY a.funding_source, f.display_name`,
    ).all(...params) as { funding_source: string; funding_source_name: string; count: number }[];

    const unitRows = db.query(
      `SELECT u.id AS unit_id, u.name AS unit_name, COUNT(a.id) AS count
       FROM school_units u
       LEFT JOIN inventory_assets a ON (a.current_unit_id = u.id OR (a.current_unit_id IS NULL AND a.school_unit_id = u.id))
       WHERE u.status = 'ACTIVE'
       GROUP BY u.id, u.name`,
    ).all() as { unit_id: number; unit_name: string; count: number }[];

    return {
      total_assets: totalRow?.total_assets ? Number(totalRow.total_assets) : 0,
      total_value: totalRow?.total_value ? Number(totalRow.total_value) : 0,
      active_count: totalRow?.active_count ? Number(totalRow.active_count) : 0,
      retired_count: totalRow?.retired_count ? Number(totalRow.retired_count) : 0,
      by_condition: {
        baik: totalRow?.baik_count ? Number(totalRow.baik_count) : 0,
        rusak_ringan: totalRow?.rusak_ringan_count ? Number(totalRow.rusak_ringan_count) : 0,
        rusak_berat: totalRow?.rusak_berat_count ? Number(totalRow.rusak_berat_count) : 0,
      },
      by_category: categoryRows.map((r) => ({ category: r.category as AssetCategoryDto, category_name: r.category_name, count: Number(r.count) })),
      by_funding: fundingRows.map((r) => ({ funding_source: r.funding_source as FundingSourceDto, funding_source_name: r.funding_source_name, count: Number(r.count) })),
      by_unit: unitRows.map((r) => ({ unit_id: Number(r.unit_id), unit_name: String(r.unit_name), count: Number(r.count) })),
    };
  });

  app.get("/api/inventory/assets", ({ query, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_inventory" });
    if (!user) return { detail: "Authentication required" };

    const db = context.database.client;
    const conditions: string[] = ["1=1"];
    const params: SqliteBinding[] = [];

    if (query.school_unit_id) {
      conditions.push("(a.school_unit_id = ? OR a.current_unit_id = ?)");
      params.push(Number(query.school_unit_id), Number(query.school_unit_id));
    }
    if (query.current_unit_id) {
      conditions.push("a.current_unit_id = ?");
      params.push(Number(query.current_unit_id));
    }
    if (query.category) {
      conditions.push("a.category = ?");
      params.push(String(query.category));
    }
    if (query.funding_source) {
      conditions.push("a.funding_source = ?");
      params.push(String(query.funding_source));
    }
    if (query.condition) {
      conditions.push("a.condition = ?");
      params.push(String(query.condition));
    }
    if (query.status) {
      conditions.push("a.status = ?");
      params.push(String(query.status));
    }
    if (query.budget_year) {
      conditions.push("a.budget_year = ?");
      params.push(Number(query.budget_year));
    }
    if (query.search) {
      const term = `%${String(query.search).trim()}%`;
      conditions.push(
        "(a.item_name LIKE ? OR a.asset_code LIKE ? OR a.brand LIKE ? OR a.model LIKE ? OR a.serial_number LIKE ? OR a.location LIKE ?)",
      );
      params.push(term, term, term, term, term, term);
    }

    const whereClause = conditions.join(" AND ");

    const totalRow = db.query(
      `SELECT COUNT(*) AS count FROM inventory_assets a WHERE ${whereClause}`,
    ).get(...params) as { count: number };
    const total = totalRow.count;

    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 1000);
    const offset = Math.max(Number(query.offset ?? 0), 0);

    const assetRows = db.query(
      `SELECT a.*, c.display_name AS category_name, f.display_name AS funding_source_name,
              u.name AS school_unit_name, COALESCE(cu.name, u.name) AS current_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
       JOIN inventory_asset_categories c ON c.code = a.category
       JOIN inventory_funding_sources f ON f.code = a.funding_source
       LEFT JOIN school_units cu ON cu.id = a.current_unit_id
       WHERE ${whereClause}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as Row[];

    return {
      items: assetRows.map(mapRowToAssetDto),
      total,
      limit,
      offset,
    };
  }, { query: AssetQuery });

  app.get("/api/inventory/assets/:id", ({ params, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_inventory" });
    if (!user) return { detail: "Authentication required" };

    const db = context.database.client;
    const assetRow = db.query(
      `SELECT a.*, c.display_name AS category_name, f.display_name AS funding_source_name,
              u.name AS school_unit_name, COALESCE(cu.name, u.name) AS current_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
       JOIN inventory_asset_categories c ON c.code = a.category
       JOIN inventory_funding_sources f ON f.code = a.funding_source
       LEFT JOIN school_units cu ON cu.id = a.current_unit_id
       WHERE a.id = ?`,
    ).get(params.id) as Row | null;

    if (!assetRow) {
      set.status = 404;
      return { detail: "Asset not found" };
    }

    return mapRowToAssetDto(assetRow);
  });

  app.post("/api/inventory/assets", ({ body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "manage_inventory" });
    if (!user) return { detail: "Insufficient permissions" };

    const db = context.database.client;
    const unit = db.query("SELECT id, name, status FROM school_units WHERE id = ?").get(body.school_unit_id) as Row | null;
    if (!unit || unit.status !== "ACTIVE") {
      set.status = 400;
      return { detail: "Invalid or inactive school unit" };
    }

    if (body.funding_source === "BOS" && (!body.budget_year || body.budget_year < 2000)) {
      set.status = 400;
      return { detail: "Budget year is required for BOS-funded acquisitions" };
    }

    const currentUnitId = body.current_unit_id ?? unit.id;
    if (body.current_unit_id) {
      const assigned = db.query("SELECT id FROM school_units WHERE id = ?").get(body.current_unit_id) as Row | null;
      if (!assigned) {
        set.status = 400;
        return { detail: "Invalid assigned school unit" };
      }
    }

    const prefix = deriveSchoolUnitPrefix(unit.name);
    const assetId = `ast_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

    let newAsset: AssetDtoType | null = null;

    try {
      inTransaction(db, () => {
      requireActiveMaster(db, "inventory_asset_categories", body.category);
      requireActiveMaster(db, "inventory_funding_sources", body.funding_source);
      const [seq] = allocateSequences(db, unit.id, body.category, 1);
      const assetCode = `${prefix}-${body.category}-${String(seq).padStart(4, "0")}`;

      db.run(
        `INSERT INTO inventory_assets
          (id, asset_code, school_unit_id, current_unit_id, category, item_name, brand, model, serial_number, location, funding_source, budget_year, arkas_account_code, purchase_document_reference, acquisition_date, price, condition, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assetId,
          assetCode,
          unit.id,
          currentUnitId,
          body.category,
          body.item_name.trim(),
          body.brand?.trim() || null,
          body.model?.trim() || null,
          body.serial_number?.trim() || null,
          body.location?.trim() || null,
          body.funding_source,
          body.budget_year,
          body.arkas_account_code?.trim() || null,
          body.purchase_document_reference?.trim() || null,
          body.acquisition_date || null,
          body.price != null ? body.price : null,
          body.condition ?? "BAIK",
          body.notes?.trim() || null,
        ],
      );

      audit(
        db,
        user,
        "CREATE_ASSET",
        assetId,
        ["id", "asset_code", "item_name", "school_unit_id", "category"],
        { asset_code: assetCode, item_name: body.item_name, school_unit_id: unit.id },
      );

      const inserted = db.query(
        `SELECT a.*, c.display_name AS category_name, f.display_name AS funding_source_name,
                u.name AS school_unit_name, COALESCE(cu.name, u.name) AS current_unit_name
         FROM inventory_assets a
         JOIN school_units u ON u.id = a.school_unit_id
         JOIN inventory_asset_categories c ON c.code = a.category
         JOIN inventory_funding_sources f ON f.code = a.funding_source
         LEFT JOIN school_units cu ON cu.id = a.current_unit_id
         WHERE a.id = ?`,
      ).get(assetId) as Row;

      newAsset = mapRowToAssetDto(inserted);
      });
    } catch (error) {
      if (inactiveMasterError(error)) {
        set.status = 400;
        return { detail: "Inactive categories or funding sources cannot be assigned to new assets" };
      }
      throw error;
    }

    set.status = 201;
    return newAsset!;
  }, { body: CreateAssetRequest });

  app.post("/api/inventory/assets/batch", ({ body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "manage_inventory" });
    if (!user) return { detail: "Insufficient permissions" };

    const db = context.database.client;
    const unit = db.query("SELECT id, name, status FROM school_units WHERE id = ?").get(body.school_unit_id) as Row | null;
    if (!unit || unit.status !== "ACTIVE") {
      set.status = 400;
      return { detail: "Invalid or inactive school unit" };
    }

    if (body.funding_source === "BOS" && (!body.budget_year || body.budget_year < 2000)) {
      set.status = 400;
      return { detail: "Budget year is required for BOS-funded acquisitions" };
    }

    const currentUnitId = body.current_unit_id ?? unit.id;
    if (body.current_unit_id) {
      const assigned = db.query("SELECT id FROM school_units WHERE id = ?").get(body.current_unit_id) as Row | null;
      if (!assigned) {
        set.status = 400;
        return { detail: "Invalid assigned school unit" };
      }
    }

    const quantity = Math.min(Math.max(body.quantity, 1), 100);
    const prefix = deriveSchoolUnitPrefix(unit.name);
    const createdItems: AssetDtoType[] = [];

    try {
      inTransaction(db, () => {
      const categoryName = requireActiveMaster(db, "inventory_asset_categories", body.category);
      const fundingSourceName = requireActiveMaster(db, "inventory_funding_sources", body.funding_source);
      const sequences = allocateSequences(db, unit.id, body.category, quantity);

      for (let i = 0; i < quantity; i++) {
        const seq = sequences[i]!;
        const assetId = `ast_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
        const assetCode = `${prefix}-${body.category}-${String(seq).padStart(4, "0")}`;

        db.run(
          `INSERT INTO inventory_assets
            (id, asset_code, school_unit_id, current_unit_id, category, item_name, brand, model, serial_number, location, funding_source, budget_year, arkas_account_code, purchase_document_reference, acquisition_date, price, condition, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            assetId,
            assetCode,
            unit.id,
            currentUnitId,
            body.category,
            body.item_name.trim(),
            body.brand?.trim() || null,
            body.model?.trim() || null,
            body.serial_number?.trim() || null,
            body.location?.trim() || null,
            body.funding_source,
            body.budget_year,
            body.arkas_account_code?.trim() || null,
            body.purchase_document_reference?.trim() || null,
            body.acquisition_date || null,
            body.price_per_unit != null ? body.price_per_unit : null,
            body.condition ?? "BAIK",
            body.notes?.trim() || null,
          ],
        );

        createdItems.push({
          id: assetId,
          asset_code: assetCode,
          school_unit_id: unit.id,
          school_unit_name: unit.name,
          current_unit_id: currentUnitId,
          current_unit_name: unit.name,
          category: body.category,
          category_name: categoryName,
          item_name: body.item_name.trim(),
          brand: body.brand?.trim() || null,
          model: body.model?.trim() || null,
          serial_number: body.serial_number?.trim() || null,
          location: body.location?.trim() || null,
          funding_source: body.funding_source,
          funding_source_name: fundingSourceName,
          budget_year: body.budget_year,
          arkas_account_code: body.arkas_account_code?.trim() || null,
          purchase_document_reference: body.purchase_document_reference?.trim() || null,
          acquisition_date: body.acquisition_date || null,
          price: body.price_per_unit != null ? body.price_per_unit : null,
          condition: body.condition ?? "BAIK",
          status: "ACTIVE",
          retired_at: null,
          retired_reason: null,
          notes: body.notes?.trim() || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      audit(
        db,
        user,
        "BATCH_CREATE_ASSET",
        `${prefix}-${body.category}`,
        ["batch_create", "quantity"],
        {
          quantity,
          category: body.category,
          school_unit_id: unit.id,
          start_code: createdItems[0]?.asset_code,
          end_code: createdItems[createdItems.length - 1]?.asset_code,
        },
      );
      });
    } catch (error) {
      if (inactiveMasterError(error)) {
        set.status = 400;
        return { detail: "Inactive categories or funding sources cannot be assigned to new assets" };
      }
      throw error;
    }

    set.status = 201;
    return {
      items: createdItems,
      created_count: createdItems.length,
    };
  }, { body: BatchCreateAssetRequest });

  app.put("/api/inventory/assets/:id", ({ params, body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "manage_inventory" });
    if (!user) return { detail: "Insufficient permissions" };

    const db = context.database.client;
    const existing = db.query("SELECT * FROM inventory_assets WHERE id = ?").get(params.id) as Row | null;
    if (!existing) {
      set.status = 404;
      return { detail: "Asset not found" };
    }
    if (existing.status === "RETIRED") {
      set.status = 400;
      return { detail: "Cannot modify a retired asset" };
    }

    const updates: string[] = ["updated_at = CURRENT_TIMESTAMP"];
    const values: SqliteBinding[] = [];
    const changedFields: string[] = [];

    if (body.item_name !== undefined) {
      updates.push("item_name = ?");
      values.push(body.item_name.trim());
      changedFields.push("item_name");
    }
    if (body.category !== undefined) {
      updates.push("category = ?");
      values.push(body.category);
      changedFields.push("category");
    }
    if (body.current_unit_id !== undefined) {
      if (body.current_unit_id !== null) {
        const u = db.query("SELECT id FROM school_units WHERE id = ?").get(body.current_unit_id) as Row | null;
        if (!u) {
          set.status = 400;
          return { detail: "Invalid school unit for transfer" };
        }
      }
      updates.push("current_unit_id = ?");
      values.push(body.current_unit_id);
      changedFields.push("current_unit_id");
    }
    if (body.brand !== undefined) {
      updates.push("brand = ?");
      values.push(body.brand ? body.brand.trim() : null);
      changedFields.push("brand");
    }
    if (body.model !== undefined) {
      updates.push("model = ?");
      values.push(body.model ? body.model.trim() : null);
      changedFields.push("model");
    }
    if (body.serial_number !== undefined) {
      updates.push("serial_number = ?");
      values.push(body.serial_number ? body.serial_number.trim() : null);
      changedFields.push("serial_number");
    }
    if (body.location !== undefined) {
      updates.push("location = ?");
      values.push(body.location ? body.location.trim() : null);
      changedFields.push("location");
    }
    if (body.funding_source !== undefined) {
      updates.push("funding_source = ?");
      values.push(body.funding_source);
      changedFields.push("funding_source");
    }
    if (body.budget_year !== undefined) {
      updates.push("budget_year = ?");
      values.push(body.budget_year);
      changedFields.push("budget_year");
    }
    if (body.arkas_account_code !== undefined) {
      updates.push("arkas_account_code = ?");
      values.push(body.arkas_account_code ? body.arkas_account_code.trim() : null);
      changedFields.push("arkas_account_code");
    }
    if (body.purchase_document_reference !== undefined) {
      updates.push("purchase_document_reference = ?");
      values.push(body.purchase_document_reference ? body.purchase_document_reference.trim() : null);
      changedFields.push("purchase_document_reference");
    }
    if (body.acquisition_date !== undefined) {
      updates.push("acquisition_date = ?");
      values.push(body.acquisition_date || null);
      changedFields.push("acquisition_date");
    }
    if (body.price !== undefined) {
      updates.push("price = ?");
      values.push(body.price != null ? body.price : null);
      changedFields.push("price");
    }
    if (body.condition !== undefined) {
      updates.push("condition = ?");
      values.push(body.condition);
      changedFields.push("condition");
    }
    if (body.notes !== undefined) {
      updates.push("notes = ?");
      values.push(body.notes ? body.notes.trim() : null);
      changedFields.push("notes");
    }

    values.push(params.id);

    try {
      inTransaction(db, () => {
      const current = db.query("SELECT category, funding_source FROM inventory_assets WHERE id = ?").get(params.id) as Row;
      if (body.category !== undefined) requireActiveMaster(db, "inventory_asset_categories", body.category, String(current.category));
      if (body.funding_source !== undefined) requireActiveMaster(db, "inventory_funding_sources", body.funding_source, String(current.funding_source));
      db.run(`UPDATE inventory_assets SET ${updates.join(", ")} WHERE id = ?`, values);

      audit(
        db,
        user,
        "UPDATE_ASSET",
        params.id,
        changedFields,
        {
          asset_code: existing.asset_code,
          before_price: existing.price,
          after_price: body.price !== undefined ? body.price : existing.price,
        },
      );
      });
    } catch (error) {
      if (inactiveMasterError(error)) {
        set.status = 400;
        return { detail: "Inactive categories or funding sources cannot be assigned to assets" };
      }
      throw error;
    }

    const updated = db.query(
      `SELECT a.*, c.display_name AS category_name, f.display_name AS funding_source_name,
              u.name AS school_unit_name, COALESCE(cu.name, u.name) AS current_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
       JOIN inventory_asset_categories c ON c.code = a.category
       JOIN inventory_funding_sources f ON f.code = a.funding_source
       LEFT JOIN school_units cu ON cu.id = a.current_unit_id
       WHERE a.id = ?`,
    ).get(params.id) as Row;

    return mapRowToAssetDto(updated);
  }, { body: UpdateAssetRequest });

  app.post("/api/inventory/assets/:id/retire", ({ params, body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "manage_inventory" });
    if (!user) return { detail: "Insufficient permissions" };

    const db = context.database.client;
    const existing = db.query("SELECT * FROM inventory_assets WHERE id = ?").get(params.id) as Row | null;
    if (!existing) {
      set.status = 404;
      return { detail: "Asset not found" };
    }
    if (existing.status === "RETIRED") {
      set.status = 400;
      return { detail: "Asset is already retired" };
    }

    const retiredAt = body.retired_at || new Date().toISOString();
    const retiredReason = body.retired_reason.trim();

    inTransaction(db, () => {
      db.run(
        `UPDATE inventory_assets
         SET status = 'RETIRED', retired_at = ?, retired_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [retiredAt, retiredReason, params.id],
      );

      audit(
        db,
        user,
        "RETIRE_ASSET",
        params.id,
        ["status", "retired_at", "retired_reason"],
        { asset_code: existing.asset_code, reason: retiredReason },
      );
    });

    const updated = db.query(
      `SELECT a.*, c.display_name AS category_name, f.display_name AS funding_source_name,
              u.name AS school_unit_name, COALESCE(cu.name, u.name) AS current_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
       JOIN inventory_asset_categories c ON c.code = a.category
       JOIN inventory_funding_sources f ON f.code = a.funding_source
       LEFT JOIN school_units cu ON cu.id = a.current_unit_id
       WHERE a.id = ?`,
    ).get(params.id) as Row;

    return mapRowToAssetDto(updated);
  }, { body: RetireAssetRequest });

  app.get("/api/inventory/export/xlsx", async ({ query, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "export_inventory" });
    if (!user) return { detail: "Insufficient permissions" };

    const db = context.database.client;
    const conditions: string[] = ["1=1"];
    const params: SqliteBinding[] = [];

    if (query.school_unit_id) {
      conditions.push("(a.school_unit_id = ? OR a.current_unit_id = ?)");
      params.push(Number(query.school_unit_id), Number(query.school_unit_id));
    }
    if (query.category) {
      conditions.push("a.category = ?");
      params.push(String(query.category));
    }
    if (query.funding_source) {
      conditions.push("a.funding_source = ?");
      params.push(String(query.funding_source));
    }
    if (query.condition) {
      conditions.push("a.condition = ?");
      params.push(String(query.condition));
    }
    if (query.status) {
      conditions.push("a.status = ?");
      params.push(String(query.status));
    }
    if (query.budget_year) {
      conditions.push("a.budget_year = ?");
      params.push(Number(query.budget_year));
    }
    if (query.search) {
      const term = `%${String(query.search).trim()}%`;
      conditions.push(
        "(a.item_name LIKE ? OR a.asset_code LIKE ? OR a.brand LIKE ? OR a.model LIKE ? OR a.serial_number LIKE ? OR a.location LIKE ?)",
      );
      params.push(term, term, term, term, term, term);
    }

    const whereClause = conditions.join(" AND ");

    const assetRows = db.query(
      `SELECT a.*, c.display_name AS category_name, f.display_name AS funding_source_name,
              u.name AS school_unit_name, COALESCE(cu.name, u.name) AS current_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
       JOIN inventory_asset_categories c ON c.code = a.category
       JOIN inventory_funding_sources f ON f.code = a.funding_source
       LEFT JOIN school_units cu ON cu.id = a.current_unit_id
       WHERE ${whereClause}
       ORDER BY a.asset_code ASC`,
    ).all(...params) as Row[];

    const workbook = createWorkbook();
    const sheet = addWorksheet(workbook, "Buku Inventaris");

    const headers = [
      "No",
      "Kode Aset",
      "Nama Barang",
      "Unit Perolehan",
      "Unit Saat Ini",
      "Kategori",
      "Merk",
      "Model",
      "No. Seri",
      "Lokasi / Ruangan",
      "Sumber Dana",
      "Tahun Anggaran",
      "Kode Rekening ARKAS",
      "No. Bukti / Dokumen",
      "Tanggal Perolehan",
      "Harga (Rp)",
      "Kondisi",
      "Status",
      "Tanggal Dihapus",
      "Alasan Dihapus",
      "Catatan",
    ];

    appendRow(sheet, headers);
    styleHeader(sheet);

    const rowsData = assetRows.map((row, idx) => [
      idx + 1,
      row.asset_code,
      row.item_name,
      row.school_unit_name,
      row.current_unit_name,
      row.category_name,
      row.brand || "-",
      row.model || "-",
      row.serial_number || "-",
      row.location || "-",
      row.funding_source_name,
      row.budget_year,
      row.arkas_account_code || "-",
      row.purchase_document_reference || "-",
      row.acquisition_date || "-",
      row.price != null ? row.price : "-",
      row.condition,
      row.status,
      row.retired_at || "-",
      row.retired_reason || "-",
      row.notes || "-",
    ]);

    appendRows(sheet, rowsData);
    autoSizeColumns(sheet);

    audit(
      db,
      user,
      "EXPORT_INVENTORY_XLSX",
      "ALL",
      ["export_xlsx"],
      { count: assetRows.length },
      "export_inventory",
      "LOW",
    );

    try {
      const bytes = await writeXlsxWorkbook(workbook);
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const filename = safeExportFilename(`inventaris-aset-${dateStr}`, "xlsx");

      return new Response(bytes, {
        headers: {
          "content-type": XLSX_MIME_TYPE,
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
        },
      });
    } catch (err: any) {
      set.status = 500;
      return { detail: `Failed to generate Excel export: ${err.message}` };
    }
  }, { query: AssetQuery });

  app.get("/api/inventory/labels/templates", ({ set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_inventory" });
    if (!user) return { detail: "Authentication required" };

    return {
      items: getRegisteredLabelTemplates(),
    };
  });

  app.post("/api/inventory/labels/preview", ({ body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_inventory" });
    if (!user) return { detail: "Authentication required" };

    const template = getLabelTemplate(body.template_id);
    if (!template) {
      set.status = 400;
      return { detail: `Unknown label template: ${body.template_id}` };
    }

    const startingIndex = body.starting_index ?? 0;
    if (startingIndex < 0 || startingIndex >= template.slotsPerPage) {
      set.status = 400;
      return {
        detail: `Invalid starting_index ${startingIndex} for template ${template.id} (valid: 0..${template.slotsPerPage - 1})`,
      };
    }

    try {
      validateCalibrationOffsets(
        template,
        body.offset_x_mm ?? template.defaultOffsetXMm,
        body.offset_y_mm ?? template.defaultOffsetYMm,
      );
    } catch (err: any) {
      set.status = 400;
      return { detail: err.message };
    }

    const db = context.database.client;
    const placeholders = body.asset_ids.map(() => "?").join(", ");
    const rows = db.query(
      `SELECT a.id, a.asset_code, a.item_name, c.display_name AS category, a.brand, a.location, f.display_name AS funding_source, a.budget_year, a.condition, u.name AS school_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
       JOIN inventory_asset_categories c ON c.code = a.category
       JOIN inventory_funding_sources f ON f.code = a.funding_source
       WHERE a.id IN (${placeholders})`,
    ).all(...body.asset_ids) as Row[];

    // Preserve order of requested ids
    const assetMap = new Map(rows.map((r) => [r.id, r]));
    const assets = body.asset_ids.map((id: string) => assetMap.get(id)).filter(Boolean) as Row[];

    const pages = paginateLabelItems(template, assets, startingIndex);
    const items = pages.flatMap((page) =>
      page.slots.map(({ slot, item: asset }) => ({
        page_number: page.pageNumber,
        slot_index: slot.index,
        asset_code: asset.asset_code,
        item_name: asset.item_name,
        school_unit_name: asset.school_unit_name,
      })),
    );

    return {
      template: {
        id: template.id,
        name: template.name,
        family: template.family,
        columns: template.columns,
        rows: template.rows,
        slots_per_page: template.slotsPerPage,
        page_width_mm: template.pageWidthMm,
        page_height_mm: template.pageHeightMm,
        orientation: template.orientation,
        label_width_mm: template.labelWidthMm,
        label_height_mm: template.labelHeightMm,
        supports_cutting_guides: template.supportsCuttingGuides,
        verification_status: template.verificationStatus,
      },
      total_assets: assets.length,
      starting_index: startingIndex,
      total_pages: pages.length,
      items,
      pages: pages.map((page) => ({
        page_number: page.pageNumber,
        start_slot: page.startSlot,
        labels_on_page: page.slots.length,
        labels: page.slots.map(({ slot, item: asset }) => ({
          slot_index: slot.index,
          asset_code: asset.asset_code,
          item_name: asset.item_name,
          school_unit_name: asset.school_unit_name,
        })),
      })),
    };
  }, { body: LabelPrintRequest });

  app.post("/api/inventory/labels/pdf", async ({ body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_inventory" });
    if (!user) return { detail: "Authentication required" };

    const template = getLabelTemplate(body.template_id);
    if (!template) {
      set.status = 400;
      return { detail: `Unknown label template: ${body.template_id}` };
    }

    const startingIndex = body.starting_index ?? 0;
    if (startingIndex < 0 || startingIndex >= template.slotsPerPage) {
      set.status = 400;
      return {
        detail: `Invalid starting_index ${startingIndex} for template ${template.id} (valid: 0..${template.slotsPerPage - 1})`,
      };
    }

    try {
      validateCalibrationOffsets(
        template,
        body.offset_x_mm ?? template.defaultOffsetXMm,
        body.offset_y_mm ?? template.defaultOffsetYMm,
      );
    } catch (err: any) {
      set.status = 400;
      return { detail: err.message };
    }

    const db = context.database.client;
    const placeholders = body.asset_ids.map(() => "?").join(", ");
    const rows = db.query(
      `SELECT a.id, a.asset_code, a.item_name, c.display_name AS category, a.brand, a.location, f.display_name AS funding_source, a.budget_year, a.condition, u.name AS school_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
       JOIN inventory_asset_categories c ON c.code = a.category
       JOIN inventory_funding_sources f ON f.code = a.funding_source
       WHERE a.id IN (${placeholders})`,
    ).all(...body.asset_ids) as Row[];

    const assetMap = new Map(rows.map((r) => [r.id, r]));
    const assets: LabelAssetItem[] = body.asset_ids
      .map((id: string) => assetMap.get(id))
      .filter((r: any): r is Row => Boolean(r))
      .map((r: Row) => ({
        id: String(r.id),
        asset_code: String(r.asset_code),
        item_name: String(r.item_name),
        school_unit_name: String(r.school_unit_name),
        category: String(r.category),
        brand: r.brand ? String(r.brand) : null,
        location: r.location ? String(r.location) : null,
        funding_source: String(r.funding_source),
        budget_year: Number(r.budget_year),
        condition: String(r.condition),
      }));

    if (assets.length === 0) {
      set.status = 400;
      return { detail: "No valid assets selected for printing" };
    }

    try {
      const pdfBytes = await generateAssetLabelsPdf(assets, {
        templateId: body.template_id,
        startingIndex,
        offsetXmm: body.offset_x_mm ?? template.defaultOffsetXMm,
        offsetYmm: body.offset_y_mm ?? template.defaultOffsetYMm,
        monochrome: body.monochrome ?? false,
        cuttingGuides: body.cutting_guides,
      });

      audit(
        db,
        user,
        "PRINT_LABELS_PDF",
        body.template_id,
        ["print_labels"],
        {
          count: assets.length,
          template_id: body.template_id,
          starting_index: startingIndex,
        },
        "view_inventory",
        "LOW",
      );

      const filename = `label-aset-${body.template_id}-${new Date().toISOString().slice(0, 10)}.pdf`;

      return new Response(pdfBytes, {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="${filename}"`,
          "cache-control": "no-store",
        },
      });
    } catch (err: any) {
      set.status = 500;
      return { detail: `Failed to generate PDF labels: ${err.message}` };
    }
  }, { body: LabelPrintRequest });

  app.post("/api/inventory/labels/calibration-pdf", async ({ body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_inventory" });
    if (!user) return { detail: "Authentication required" };

    const template = getLabelTemplate(body.template_id);
    if (!template) {
      set.status = 400;
      return { detail: `Unknown label template: ${body.template_id}` };
    }

    try {
      validateCalibrationOffsets(
        template,
        body.offset_x_mm ?? template.defaultOffsetXMm,
        body.offset_y_mm ?? template.defaultOffsetYMm,
      );
    } catch (err: any) {
      set.status = 400;
      return { detail: err.message };
    }

    const pdfBytes = await generateCalibrationPdf({
      templateId: body.template_id,
      offsetXmm: body.offset_x_mm ?? template.defaultOffsetXMm,
      offsetYmm: body.offset_y_mm ?? template.defaultOffsetYMm,
      monochrome: body.monochrome ?? false,
      cuttingGuides: body.cutting_guides,
    });

    const filename = `kalibrasi-label-${body.template_id}.pdf`;
    return new Response(pdfBytes, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  }, { body: LabelCalibrationRequest });
}
