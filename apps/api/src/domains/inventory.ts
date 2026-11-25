import { randomUUID } from "node:crypto";
import type { Elysia } from "elysia";
import type { SqliteBinding, SqliteClient } from "@operatoros/db";
import { inTransaction } from "@operatoros/db";
import {
  AssetQuery,
  CreateAssetRequest,
  BatchCreateAssetRequest,
  UpdateAssetRequest,
  RetireAssetRequest,
  LabelPrintRequest,
  type AssetDtoType,
} from "@operatoros/contracts/inventory";
import { addWorksheet, appendRow, appendRows, autoSizeColumns, createWorkbook, safeExportFilename, styleHeader, writeXlsxWorkbook, XLSX_MIME_TYPE } from "@operatoros/excel";
import type { AuthContext, CurrentUser } from "../auth/service";
import { actor } from "./core";
import { generateAssetLabelsPdf, LABEL_TEMPLATES, type LabelAssetItem } from "./inventory-labels";

type Row = Record<string, any>;
type Context = any;

export function deriveSchoolUnitPrefix(name: string): string {
  const trimmed = name.trim().toUpperCase();
  if (trimmed.startsWith("SD") || trimmed.includes(" SD ") || trimmed.endsWith(" SD")) return "SD";
  if (trimmed.startsWith("SMP") || trimmed.includes(" SMP ") || trimmed.endsWith(" SMP")) return "SMP";
  if (trimmed.startsWith("SMA") || trimmed.includes(" SMA ") || trimmed.endsWith(" SMA")) return "SMA";
  if (trimmed.startsWith("SMK") || trimmed.includes(" SMK ") || trimmed.endsWith(" SMK")) return "SMK";
  if (trimmed.startsWith("TK") || trimmed.includes(" TK ")) return "TK";
  const alphanumeric = trimmed.replace(/[^A-Z0-9]/g, "");
  return alphanumeric.slice(0, 4) || "SCH";
}

export function allocateSequences(client: SqliteClient, unitId: number, category: string, count: number): number[] {
  const row = client.query("SELECT last_sequence FROM inventory_asset_sequences WHERE school_unit_id = ? AND category = ?").get(unitId, category) as { last_sequence: number } | null;
  const current = row ? row.last_sequence : 0;
  const next = current + count;
  if (!row) {
    client.run("INSERT INTO inventory_asset_sequences (school_unit_id, category, last_sequence) VALUES (?, ?, ?)", [unitId, category, next]);
  } else {
    client.run("UPDATE inventory_asset_sequences SET last_sequence = ? WHERE school_unit_id = ? AND category = ?", [next, unitId, category]);
  }
  const sequences: number[] = [];
  for (let i = 1; i <= count; i++) {
    sequences.push(current + i);
  }
  return sequences;
}

function audit(
  client: SqliteClient,
  user: CurrentUser,
  operation: string,
  entityReference: string,
  changedFields: string[],
  metadata: Record<string, unknown> = {},
  capability = "manage_inventory",
  riskLevel: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM",
): void {
  client.run(
    `INSERT INTO operations_audit_events
      (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, success, changed_fields, metadata, schema_version)
      VALUES (?, ?, ?, ?, 'ASSET_INVENTORY', ?, ?, ?, 'API', 1, ?, ?, '1')`,
    [
      randomUUID(),
      user.username,
      user.role,
      capability,
      entityReference,
      operation,
      riskLevel,
      JSON.stringify(changedFields),
      JSON.stringify(metadata),
    ],
  );
}

function mapRowToAssetDto(row: Row): AssetDtoType {
  return {
    id: String(row.id),
    asset_code: String(row.asset_code),
    school_unit_id: Number(row.school_unit_id),
    school_unit_name: String(row.school_unit_name || ""),
    category: row.category,
    item_name: String(row.item_name),
    brand: row.brand ? String(row.brand) : null,
    location: row.location ? String(row.location) : null,
    funding_source: row.funding_source,
    budget_year: Number(row.budget_year),
    acquisition_date: row.acquisition_date ? String(row.acquisition_date) : null,
    price: row.price != null ? Number(row.price) : null,
    condition: row.condition,
    status: row.status,
    retired_at: row.retired_at ? String(row.retired_at) : null,
    retired_reason: row.retired_reason ? String(row.retired_reason) : null,
    notes: row.notes ? String(row.notes) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function inventoryRoutes(app: Elysia, context: AuthContext) {
  app.get("/api/inventory/assets", ({ query, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_inventory" });
    if (!user) return { detail: "Authentication required" };

    const db = context.database.client;
    const conditions: string[] = ["1=1"];
    const params: SqliteBinding[] = [];

    if (query.school_unit_id) {
      conditions.push("a.school_unit_id = ?");
      params.push(Number(query.school_unit_id));
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
      conditions.push("(a.item_name LIKE ? OR a.asset_code LIKE ? OR a.brand LIKE ? OR a.location LIKE ?)");
      params.push(term, term, term, term);
    }

    const whereClause = conditions.join(" AND ");

    const totalRow = db.query(
      `SELECT COUNT(*) AS count FROM inventory_assets a WHERE ${whereClause}`,
    ).get(...params) as { count: number };
    const total = totalRow.count;

    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 1000);
    const offset = Math.max(Number(query.offset ?? 0), 0);

    const assetRows = db.query(
      `SELECT a.*, u.name AS school_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
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
      `SELECT a.*, u.name AS school_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
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

    const prefix = deriveSchoolUnitPrefix(unit.name);
    const assetId = `ast_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

    let newAsset: AssetDtoType | null = null;

    inTransaction(db, () => {
      const [seq] = allocateSequences(db, unit.id, body.category, 1);
      const assetCode = `${prefix}-${body.category}-${String(seq).padStart(4, "0")}`;

      db.run(
        `INSERT INTO inventory_assets
          (id, asset_code, school_unit_id, category, item_name, brand, location, funding_source, budget_year, acquisition_date, price, condition, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assetId,
          assetCode,
          unit.id,
          body.category,
          body.item_name.trim(),
          body.brand?.trim() || null,
          body.location?.trim() || null,
          body.funding_source,
          body.budget_year,
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
        `SELECT a.*, u.name AS school_unit_name
         FROM inventory_assets a
         JOIN school_units u ON u.id = a.school_unit_id
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
            (id, asset_code, school_unit_id, category, item_name, brand, location, funding_source, budget_year, acquisition_date, price, condition, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            assetId,
            assetCode,
            unit.id,
            body.category,
            body.item_name.trim(),
            body.brand?.trim() || null,
            body.location?.trim() || null,
            body.funding_source,
            body.budget_year,
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
          category: body.category,
          item_name: body.item_name.trim(),
          brand: body.brand?.trim() || null,
          location: body.location?.trim() || null,
          funding_source: body.funding_source,
          budget_year: body.budget_year,
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
    if (body.brand !== undefined) {
      updates.push("brand = ?");
      values.push(body.brand ? body.brand.trim() : null);
      changedFields.push("brand");
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
        { asset_code: existing.asset_code },
      );
    });

    const updated = db.query(
      `SELECT a.*, u.name AS school_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
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
        { asset_code: existing.asset_code, retired_reason: retiredReason },
        "manage_inventory",
        "HIGH",
      );
    });

    const updated = db.query(
      `SELECT a.*, u.name AS school_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
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
      conditions.push("a.school_unit_id = ?");
      params.push(Number(query.school_unit_id));
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
      conditions.push("(a.item_name LIKE ? OR a.asset_code LIKE ? OR a.brand LIKE ? OR a.location LIKE ?)");
      params.push(term, term, term, term);
    }

    const whereClause = conditions.join(" AND ");

    const assetRows = db.query(
      `SELECT a.*, u.name AS school_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
       WHERE ${whereClause}
       ORDER BY a.asset_code ASC`,
    ).all(...params) as Row[];

    const workbook = createWorkbook();
    const sheet = addWorksheet(workbook, "Buku Inventaris");

    const headers = [
      "No",
      "Kode Aset",
      "Unit Sekolah",
      "Kategori",
      "Nama Barang",
      "Merk / Model",
      "Lokasi / Ruangan",
      "Sumber Dana",
      "Tahun Anggaran",
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
      row.school_unit_name,
      row.category,
      row.item_name,
      row.brand || "-",
      row.location || "-",
      row.funding_source,
      row.budget_year,
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
      console.error("XLSX EXPORT ERROR:", err);
      set.status = 500;
      return { detail: err?.message || "Export error" };
    }
  }, { query: AssetQuery });

  app.post("/api/inventory/labels/preview", ({ body, set, ...ctx }: Context) => {
    const user = actor(context, { set, ...ctx }, { capability: "view_inventory" });
    if (!user) return { detail: "Authentication required" };

    const db = context.database.client;
    const template = LABEL_TEMPLATES[body.template_id] ?? LABEL_TEMPLATES["103"];
    const placeholders = body.asset_ids.map(() => "?").join(", ");
    const rows = db.query(
      `SELECT a.id, a.asset_code, a.item_name, a.category, a.brand, a.location, a.funding_source, a.budget_year, a.condition, u.name AS school_unit_name
       FROM inventory_assets a
       JOIN school_units u ON u.id = a.school_unit_id
       WHERE a.id IN (${placeholders})`,
    ).all(...body.asset_ids) as Row[];

    // Preserve order of requested ids
    const assetMap = new Map(rows.map((r) => [r.id, r]));
    const assets = body.asset_ids.map((id) => assetMap.get(id)).filter(Boolean) as Row[];

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
      items: assets.map((a, idx) => ({
        id: a.id,
        asset_code: a.asset_code,
        item_name: a.item_name,
        school_unit_name: a.school_unit_name,
        slot_index: startingIndex + idx,
        page_number: Math.floor((startingIndex + idx) / slotsPerPage) + 1,
      })),
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
      .map((id) => assetMap.get(id))
      .filter(Boolean)
      .map((r) => ({
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
      return { detail: "No valid assets found for label printing" };
    }

    const pdfBytes = await generateAssetLabelsPdf(assets, {
      templateId: body.template_id,
      startingIndex: body.starting_index,
      offsetXmm: body.offset_x_mm,
      offsetYmm: body.offset_y_mm,
      monochrome: body.monochrome,
    });

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const filename = `label-aset-no${body.template_id}-${dateStr}.pdf`;

    return new Response(pdfBytes, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${filename}"`,
        "cache-control": "no-store, no-cache, must-revalidate, private",
      },
    });
  }, { body: LabelPrintRequest });
}
