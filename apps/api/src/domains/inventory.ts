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
  type AssetDtoType,
  type AssetCategoryDto,
  type FundingSourceDto,
  type AssetConditionDto,
  type AssetStatusDto,
} from "@operatoros/contracts/inventory";
import { randomUUID } from "node:crypto";
import {
  generateAssetLabelsPdf,
  LABEL_TEMPLATES,
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
) {
  try {
    db.run(
      `INSERT INTO operations_audit_events
        (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, success, changed_fields, metadata, schema_version)
        VALUES (?, ?, ?, ?, 'INVENTORY_ASSET', ?, ?, ?, 'API', 1, ?, ?, '1')`,
      [
        randomUUID(),
        user.username,
        user.role,
        capability,
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

function mapRowToAssetDto(row: Row): AssetDtoType {
  return {
    id: String(row.id),
    asset_code: String(row.asset_code),
    school_unit_id: Number(row.school_unit_id),
    school_unit_name: String(row.school_unit_name || ""),
    current_unit_id: row.current_unit_id != null ? Number(row.current_unit_id) : Number(row.school_unit_id),
    current_unit_name: row.current_unit_name ? String(row.current_unit_name) : String(row.school_unit_name || ""),
    category: row.category as AssetCategoryDto,
    item_name: String(row.item_name),
    brand: row.brand ? String(row.brand) : null,
    model: row.model ? String(row.model) : null,
    serial_number: row.serial_number ? String(row.serial_number) : null,
    location: row.location ? String(row.location) : null,
    funding_source: row.funding_source as FundingSourceDto,
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
      `SELECT category, COUNT(*) AS count
       FROM inventory_assets a
       WHERE ${whereClause}
       GROUP BY category`,
    ).all(...params) as { category: string; count: number }[];

    const fundingRows = db.query(
      `SELECT funding_source, COUNT(*) AS count
       FROM inventory_assets a
       WHERE ${whereClause}
       GROUP BY funding_source`,
    ).all(...params) as { funding_source: string; count: number }[];

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
      by_category: categoryRows.map((r) => ({ category: r.category as AssetCategoryDto, count: Number(r.count) })),
      by_funding: fundingRows.map((r) => ({ funding_source: r.funding_source as FundingSourceDto, count: Number(r.count) })),
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
      `SELECT a.*, u.name AS school_unit_name, COALESCE(cu.name, u.name) AS current_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
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
      `SELECT a.*, u.name AS school_unit_name, COALESCE(cu.name, u.name) AS current_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
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

    inTransaction(db, () => {
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
        `SELECT a.*, u.name AS school_unit_name, COALESCE(cu.name, u.name) AS current_unit_name
         FROM inventory_assets a
         JOIN school_units u ON u.id = a.school_unit_id
         LEFT JOIN school_units cu ON cu.id = a.current_unit_id
         WHERE a.id = ?`,
      ).get(assetId) as Row;

      newAsset = mapRowToAssetDto(inserted);
    });

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

    inTransaction(db, () => {
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
          item_name: body.item_name.trim(),
          brand: body.brand?.trim() || null,
          model: body.model?.trim() || null,
          serial_number: body.serial_number?.trim() || null,
          location: body.location?.trim() || null,
          funding_source: body.funding_source,
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

    inTransaction(db, () => {
      db.run(
        `UPDATE inventory_assets SET ${updates.join(", ")} WHERE id = ?`,
        values,
      );

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

    const updated = db.query(
      `SELECT a.*, u.name AS school_unit_name, COALESCE(cu.name, u.name) AS current_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
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
      `SELECT a.*, u.name AS school_unit_name, COALESCE(cu.name, u.name) AS current_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
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
      `SELECT a.*, u.name AS school_unit_name, COALESCE(cu.name, u.name) AS current_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
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
      row.category,
      row.brand || "-",
      row.model || "-",
      row.serial_number || "-",
      row.location || "-",
      row.funding_source,
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

  app.post("/api/inventory/labels/preview", ({ body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_inventory" });
    if (!user) return { detail: "Authentication required" };

    const db = context.database.client;
    const template = (LABEL_TEMPLATES as any)[body.template_id] ?? LABEL_TEMPLATES["103"];
    const placeholders = body.asset_ids.map(() => "?").join(", ");
    const rows = db.query(
      `SELECT a.id, a.asset_code, a.item_name, a.category, a.brand, a.location, a.funding_source, a.budget_year, a.condition, u.name AS school_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
       WHERE a.id IN (${placeholders})`,
    ).all(...body.asset_ids) as Row[];

    // Preserve order of requested ids
    const assetMap = new Map(rows.map((r) => [r.id, r]));
    const assets = body.asset_ids.map((id: string) => assetMap.get(id)).filter(Boolean) as Row[];

    const slotsPerPage = template.columns * template.rows;
    const startingIndex = Math.min(Math.max(body.starting_index ?? 0, 0), slotsPerPage - 1);
    const totalSlotsNeeded = startingIndex + assets.length;
    const totalPages = Math.ceil(totalSlotsNeeded / slotsPerPage) || 1;

    return {
      template: {
        id: template.id,
        name: template.name,
        columns: template.columns,
        rows: template.rows,
        slots_per_page: slotsPerPage,
        label_width_mm: template.id === "103" ? 64 : 50,
        label_height_mm: template.id === "103" ? 32 : 18,
      },
      total_assets: assets.length,
      starting_index: startingIndex,
      total_pages: totalPages,
      items: assets.map((asset, slotOffset) => ({
        slot_index: startingIndex + slotOffset,
        asset_code: asset.asset_code,
        item_name: asset.item_name,
        school_unit_name: asset.school_unit_name,
      })),
      pages: Array.from({ length: totalPages }, (_, pageIdx) => {
        const pageStartSlot = pageIdx === 0 ? startingIndex : 0;
        const pageAvailableSlots = slotsPerPage - pageStartSlot;
        const assetsBeforeThisPage = pageIdx === 0 ? 0 : slotsPerPage - startingIndex + (pageIdx - 1) * slotsPerPage;
        const pageAssets = assets.slice(assetsBeforeThisPage, assetsBeforeThisPage + pageAvailableSlots);

        return {
          page_number: pageIdx + 1,
          start_slot: pageStartSlot,
          labels_on_page: pageAssets.length,
          labels: pageAssets.map((asset, slotOffset) => ({
            slot_index: pageStartSlot + slotOffset,
            asset_code: asset.asset_code,
            item_name: asset.item_name,
            school_unit_name: asset.school_unit_name,
          })),
        };
      }),
    };
  }, { body: LabelPrintRequest });

  app.post("/api/inventory/labels/pdf", async ({ body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_inventory" });
    if (!user) return { detail: "Authentication required" };

    const db = context.database.client;
    const placeholders = body.asset_ids.map(() => "?").join(", ");
    const rows = db.query(
      `SELECT a.id, a.asset_code, a.item_name, a.category, a.brand, a.location, a.funding_source, a.budget_year, a.condition, u.name AS school_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
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
        startingIndex: body.starting_index ?? 0,
        offsetXmm: body.offset_x_mm ?? 0,
        offsetYmm: body.offset_y_mm ?? 0,
        monochrome: body.monochrome ?? false,
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
          starting_index: body.starting_index ?? 0,
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
}
