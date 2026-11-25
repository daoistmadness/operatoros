import type {
  AssetDtoType,
  AssetListResponseDto,
  AssetQueryDto,
  BatchCreateAssetRequestDto,
  CreateAssetRequestDto,
  LabelPrintRequestDto,
  RetireAssetRequestDto,
  UpdateAssetRequestDto,
} from "@operatoros/contracts/inventory";
import { apiRequest } from "../lib/api/client";

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

export async function downloadInventoryXlsx(query: Record<string, any> = {}): Promise<Blob> {
  return (await apiRequest<Blob>({
    path: "/api/inventory/export/xlsx",
    params: query,
    responseType: "blob",
    expectedBlobTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  })).data;
}
