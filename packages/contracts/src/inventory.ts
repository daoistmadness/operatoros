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
  category: AssetCategory,
  item_name: Type.String(),
  brand: NullableString,
  location: NullableString,
  funding_source: FundingSource,
  budget_year: Type.Integer({ minimum: 2000, maximum: 2100 }),
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
  category: AssetCategory,
  item_name: Type.String({ minLength: 1 }),
  brand: Type.Optional(NullableString),
  location: Type.Optional(NullableString),
  funding_source: FundingSource,
  budget_year: Type.Integer({ minimum: 2000, maximum: 2100 }),
  acquisition_date: Type.Optional(NullableString),
  price: Type.Optional(NullableNumber),
  condition: Type.Optional(AssetCondition),
  notes: Type.Optional(NullableString),
});
export type CreateAssetRequestDto = Static<typeof CreateAssetRequest>;

export const BatchCreateAssetRequest = Type.Object({
  school_unit_id: Type.Integer({ minimum: 1 }),
  category: AssetCategory,
  item_name: Type.String({ minLength: 1 }),
  quantity: Type.Integer({ minimum: 1, maximum: 100 }),
  brand: Type.Optional(NullableString),
  location: Type.Optional(NullableString),
  funding_source: FundingSource,
  budget_year: Type.Integer({ minimum: 2000, maximum: 2100 }),
  acquisition_date: Type.Optional(NullableString),
  price_per_unit: Type.Optional(NullableNumber),
  condition: Type.Optional(AssetCondition),
  notes: Type.Optional(NullableString),
});
export type BatchCreateAssetRequestDto = Static<typeof BatchCreateAssetRequest>;

export const UpdateAssetRequest = Type.Object({
  item_name: Type.Optional(Type.String({ minLength: 1 })),
  brand: Type.Optional(NullableString),
  location: Type.Optional(NullableString),
  funding_source: Type.Optional(FundingSource),
  budget_year: Type.Optional(Type.Integer({ minimum: 2000, maximum: 2100 })),
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
