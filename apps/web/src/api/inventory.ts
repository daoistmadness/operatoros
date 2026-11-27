import type {
  AssetDtoType,
  AssetListResponseDto,
  AssetQueryDto,
  BatchCreateAssetRequestDto,
  CreateAssetRequestDto,
  InventorySummaryResponseDto,
  InventoryMasterDataResponseDto,
  InventoryMasterEntryDto,
  CreateAssetCategoryRequestDto,
  CreateFundingSourceRequestDto,
  UpdateInventoryMasterEntryRequestDto,
  ReorderInventoryMasterEntriesRequestDto,
  LabelCalibrationRequestDto,
  LabelPrintRequestDto,
  ResolvedLabelTemplate,
  RetireAssetRequestDto,
  UpdateAssetRequestDto,
} from "@operatoros/contracts/inventory";
import { apiRequest } from "../lib/api/client";

export async function fetchInventoryMasterData(): Promise<InventoryMasterDataResponseDto> {
  return (await apiRequest<InventoryMasterDataResponseDto>({
    path: "/api/inventory/master-data",
  })).data;
}

export async function createAssetCategory(body: CreateAssetCategoryRequestDto): Promise<InventoryMasterEntryDto> {
  return (await apiRequest<InventoryMasterEntryDto>({
    path: "/api/inventory/master-data/categories",
    method: "POST",
    body,
  })).data;
}

export async function createFundingSource(body: CreateFundingSourceRequestDto): Promise<InventoryMasterEntryDto> {
  return (await apiRequest<InventoryMasterEntryDto>({
    path: "/api/inventory/master-data/funding-sources",
    method: "POST",
    body,
  })).data;
}

export async function updateAssetCategory(code: string, body: UpdateInventoryMasterEntryRequestDto): Promise<InventoryMasterEntryDto> {
  return (await apiRequest<InventoryMasterEntryDto>({
    path: `/api/inventory/master-data/categories/${encodeURIComponent(code)}`,
    method: "PATCH",
    body,
  })).data;
}

export async function updateFundingSource(code: string, body: UpdateInventoryMasterEntryRequestDto): Promise<InventoryMasterEntryDto> {
  return (await apiRequest<InventoryMasterEntryDto>({
    path: `/api/inventory/master-data/funding-sources/${encodeURIComponent(code)}`,
    method: "PATCH",
    body,
  })).data;
}

export async function reorderAssetCategories(body: ReorderInventoryMasterEntriesRequestDto): Promise<void> {
  await apiRequest({ path: "/api/inventory/master-data/categories/order", method: "PUT", body });
}

export async function reorderFundingSources(body: ReorderInventoryMasterEntriesRequestDto): Promise<void> {
  await apiRequest({ path: "/api/inventory/master-data/funding-sources/order", method: "PUT", body });
}

export async function deleteAssetCategory(code: string): Promise<void> {
  await apiRequest({ path: `/api/inventory/master-data/categories/${encodeURIComponent(code)}`, method: "DELETE" });
}

export async function deleteFundingSource(code: string): Promise<void> {
  await apiRequest({ path: `/api/inventory/master-data/funding-sources/${encodeURIComponent(code)}`, method: "DELETE" });
}

export async function fetchInventorySummary(
  query: Record<string, any> = {},
): Promise<InventorySummaryResponseDto> {
  return (await apiRequest<InventorySummaryResponseDto>({
    path: "/api/inventory/summary",
    params: query,
  })).data;
}

export async function fetchAssets(query: Record<string, any> = {}): Promise<AssetListResponseDto> {
  return (await apiRequest<AssetListResponseDto>({
    path: "/api/inventory/assets",
    params: query,
  })).data;
}

export async function fetchAsset(id: string): Promise<AssetDtoType> {
  return (await apiRequest<AssetDtoType>({
    path: `/api/inventory/assets/${id}`,
  })).data;
}

export async function createAsset(body: CreateAssetRequestDto): Promise<AssetDtoType> {
  return (await apiRequest<AssetDtoType>({
    path: "/api/inventory/assets",
    method: "POST",
    body,
  })).data;
}

export async function batchCreateAssets(
  body: BatchCreateAssetRequestDto,
): Promise<{ items: AssetDtoType[]; created_count: number }> {
  return (await apiRequest<{ items: AssetDtoType[]; created_count: number }>({
    path: "/api/inventory/assets/batch",
    method: "POST",
    body,
  })).data;
}

export async function updateAsset(id: string, body: UpdateAssetRequestDto): Promise<AssetDtoType> {
  return (await apiRequest<AssetDtoType>({
    path: `/api/inventory/assets/${id}`,
    method: "PUT",
    body,
  })).data;
}

export async function retireAsset(id: string, body: RetireAssetRequestDto): Promise<AssetDtoType> {
  return (await apiRequest<AssetDtoType>({
    path: `/api/inventory/assets/${id}/retire`,
    method: "POST",
    body,
  })).data;
}

export async function fetchLabelTemplates(): Promise<{ items: ResolvedLabelTemplate[] }> {
  return (await apiRequest<{ items: ResolvedLabelTemplate[] }>({
    path: "/api/inventory/labels/templates",
  })).data;
}

export async function previewLabels(body: LabelPrintRequestDto): Promise<any> {
  return (await apiRequest<any>({
    path: "/api/inventory/labels/preview",
    method: "POST",
    body,
  })).data;
}

export async function downloadLabelsPdf(body: LabelPrintRequestDto): Promise<Blob> {
  return (await apiRequest<Blob>({
    path: "/api/inventory/labels/pdf",
    method: "POST",
    body,
    responseType: "blob",
    expectedBlobTypes: ["application/pdf"],
  })).data;
}

export async function downloadCalibrationPdf(body: LabelCalibrationRequestDto): Promise<Blob> {
  return (await apiRequest<Blob>({
    path: "/api/inventory/labels/calibration-pdf",
    method: "POST",
    body,
    responseType: "blob",
    expectedBlobTypes: ["application/pdf"],
  })).data;
}

export async function downloadInventoryXlsx(query: Record<string, any> = {}): Promise<Blob> {
  return (await apiRequest<Blob>({
    path: "/api/inventory/export/xlsx",
    params: query,
    responseType: "blob",
    expectedBlobTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  })).data;
}
