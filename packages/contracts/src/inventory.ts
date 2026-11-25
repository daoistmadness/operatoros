import { Type, type Static } from "@sinclair/typebox";

export const AssetCategory = Type.Union([
  Type.Literal("IT"),   // Peralatan TI / Komputer
  Type.Literal("FRN"),  // Furnitur / Mebel
  Type.Literal("ELK"),  // Elektronik
  Type.Literal("LAB"),  // Laboratorium
  Type.Literal("LIB"),  // Pustaka / Buku
  Type.Literal("SPT"),  // Olahraga
  Type.Literal("EDU"),  // Alat Edukatif
  Type.Literal("OFF"),  // Kantor
  Type.Literal("OTH"),  // Lainnya
]);
export type AssetCategoryDto = Static<typeof AssetCategory>;

export const FundingSource = Type.Union([
  Type.Literal("BOS"),      // Dana BOS (ARKAS)
  Type.Literal("BOP"),      // Dana BOP
  Type.Literal("YAYASAN"),  // Yayasan
  Type.Literal("KOMITE"),   // Komite Sekolah
  Type.Literal("HIBAH"),    // Hibah / Donasi
  Type.Literal("LAINNYA"),  // Lainnya
]);
export type FundingSourceDto = Static<typeof FundingSource>;

export const AssetCondition = Type.Union([
  Type.Literal("BAIK"),
  Type.Literal("RUSAK_RINGAN"),
  Type.Literal("RUSAK_BERAT"),
]);
export type AssetConditionDto = Static<typeof AssetCondition>;

export const AssetStatus = Type.Union([
  Type.Literal("ACTIVE"),
  Type.Literal("RETIRED"),
]);
export type AssetStatusDto = Static<typeof AssetStatus>;

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);

export const AssetDto = Type.Object({
  id: Type.String(),
  asset_code: Type.String(),
  school_unit_id: Type.Integer({ minimum: 1 }),
  school_unit_name: Type.String(),
  current_unit_id: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  current_unit_name: Type.Optional(NullableString),
  category: AssetCategory,
  item_name: Type.String(),
  brand: NullableString,
  model: NullableString,
  serial_number: NullableString,
  location: NullableString,
  funding_source: FundingSource,
  budget_year: Type.Integer({ minimum: 2000, maximum: 2100 }),
  arkas_account_code: NullableString,
  purchase_document_reference: NullableString,
  acquisition_date: NullableString,
  price: NullableNumber,
  condition: AssetCondition,
  status: AssetStatus,
  retired_at: NullableString,
  retired_reason: NullableString,
  notes: NullableString,
  created_at: Type.String(),
  updated_at: Type.String(),
});
export type AssetDtoType = Static<typeof AssetDto>;

export const CreateAssetRequest = Type.Object({
  school_unit_id: Type.Integer({ minimum: 1 }),
  current_unit_id: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  category: AssetCategory,
  item_name: Type.String({ minLength: 1 }),
  brand: Type.Optional(NullableString),
  model: Type.Optional(NullableString),
  serial_number: Type.Optional(NullableString),
  location: Type.Optional(NullableString),
  funding_source: FundingSource,
  budget_year: Type.Integer({ minimum: 2000, maximum: 2100 }),
  arkas_account_code: Type.Optional(NullableString),
  purchase_document_reference: Type.Optional(NullableString),
  acquisition_date: Type.Optional(NullableString),
  price: Type.Optional(NullableNumber),
  condition: Type.Optional(AssetCondition),
  notes: Type.Optional(NullableString),
});
export type CreateAssetRequestDto = Static<typeof CreateAssetRequest>;

export const BatchCreateAssetRequest = Type.Object({
  school_unit_id: Type.Integer({ minimum: 1 }),
  current_unit_id: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  category: AssetCategory,
  item_name: Type.String({ minLength: 1 }),
  quantity: Type.Integer({ minimum: 1, maximum: 100 }),
  brand: Type.Optional(NullableString),
  model: Type.Optional(NullableString),
  serial_number: Type.Optional(NullableString),
  location: Type.Optional(NullableString),
  funding_source: FundingSource,
  budget_year: Type.Integer({ minimum: 2000, maximum: 2100 }),
  arkas_account_code: Type.Optional(NullableString),
  purchase_document_reference: Type.Optional(NullableString),
  acquisition_date: Type.Optional(NullableString),
  price_per_unit: Type.Optional(NullableNumber),
  condition: Type.Optional(AssetCondition),
  notes: Type.Optional(NullableString),
});
export type BatchCreateAssetRequestDto = Static<typeof BatchCreateAssetRequest>;

export const UpdateAssetRequest = Type.Object({
  item_name: Type.Optional(Type.String({ minLength: 1 })),
  category: Type.Optional(AssetCategory),
  current_unit_id: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  brand: Type.Optional(NullableString),
  model: Type.Optional(NullableString),
  serial_number: Type.Optional(NullableString),
  location: Type.Optional(NullableString),
  funding_source: Type.Optional(FundingSource),
  budget_year: Type.Optional(Type.Integer({ minimum: 2000, maximum: 2100 })),
  arkas_account_code: Type.Optional(NullableString),
  purchase_document_reference: Type.Optional(NullableString),
  acquisition_date: Type.Optional(NullableString),
  price: Type.Optional(NullableNumber),
  condition: Type.Optional(AssetCondition),
  notes: Type.Optional(NullableString),
});
export type UpdateAssetRequestDto = Static<typeof UpdateAssetRequest>;

export const RetireAssetRequest = Type.Object({
  retired_reason: Type.String({ minLength: 1 }),
  retired_at: Type.Optional(Type.String()),
});
export type RetireAssetRequestDto = Static<typeof RetireAssetRequest>;

export const AssetQuery = Type.Object({
  school_unit_id: Type.Optional(Type.String()),
  current_unit_id: Type.Optional(Type.String()),
  category: Type.Optional(AssetCategory),
  funding_source: Type.Optional(FundingSource),
  condition: Type.Optional(AssetCondition),
  status: Type.Optional(AssetStatus),
  budget_year: Type.Optional(Type.String()),
  search: Type.Optional(Type.String()),
  limit: Type.Optional(Type.String()),
  offset: Type.Optional(Type.String()),
});
export type AssetQueryDto = Static<typeof AssetQuery>;

export const AssetListResponse = Type.Object({
  items: Type.Array(AssetDto),
  total: Type.Integer({ minimum: 0 }),
  limit: Type.Integer({ minimum: 1 }),
  offset: Type.Integer({ minimum: 0 }),
});
export type AssetListResponseDto = Static<typeof AssetListResponse>;

export const InventorySummaryResponse = Type.Object({
  total_assets: Type.Integer({ minimum: 0 }),
  total_value: Type.Number({ minimum: 0 }),
  active_count: Type.Integer({ minimum: 0 }),
  retired_count: Type.Integer({ minimum: 0 }),
  by_condition: Type.Object({
    baik: Type.Integer({ minimum: 0 }),
    rusak_ringan: Type.Integer({ minimum: 0 }),
    rusak_berat: Type.Integer({ minimum: 0 }),
  }),
  by_category: Type.Array(Type.Object({
    category: AssetCategory,
    count: Type.Integer({ minimum: 0 }),
  })),
  by_funding: Type.Array(Type.Object({
    funding_source: FundingSource,
    count: Type.Integer({ minimum: 0 }),
  })),
  by_unit: Type.Array(Type.Object({
    unit_id: Type.Integer({ minimum: 1 }),
    unit_name: Type.String(),
    count: Type.Integer({ minimum: 0 }),
  })),
});
export type InventorySummaryResponseDto = Static<typeof InventorySummaryResponse>;

export const LabelTemplateId = Type.Union([
  Type.Literal("103"),
  Type.Literal("107"),
]);
export type LabelTemplateIdDto = Static<typeof LabelTemplateId>;

export const LabelPrintRequest = Type.Object({
  asset_ids: Type.Array(Type.String(), { minItems: 1, maxItems: 300 }),
  template_id: LabelTemplateId,
  starting_index: Type.Optional(Type.Integer({ minimum: 0, maximum: 29 })),
  offset_x_mm: Type.Optional(Type.Number()),
  offset_y_mm: Type.Optional(Type.Number()),
  monochrome: Type.Optional(Type.Boolean()),
});
export type LabelPrintRequestDto = Static<typeof LabelPrintRequest>;
