import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Plus,
  Layers,
  Printer,
  Download,
  Search,
  Filter,
  Edit2,
  Trash2,
  CheckSquare,
  Square,
  FileSpreadsheet,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import type {
  AssetDtoType,
  AssetCategoryDto,
  FundingSourceDto,
  AssetConditionDto,
  AssetStatusDto,
  CreateAssetRequestDto,
  BatchCreateAssetRequestDto,
  UpdateAssetRequestDto,
  LabelTemplateIdDto,
} from "@operatoros/contracts/inventory";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { queryKeys } from "../lib/query/queryKeys";
import { getPageApiError } from "../lib/api/errors";
import { fetchSchoolUnits } from "../api/staff";
import {
  fetchAssets,
  createAsset,
  batchCreateAssets,
  updateAsset,
  retireAsset,
  downloadInventoryXlsx,
  downloadLabelsPdf,
  previewLabels,
} from "../api/inventory";
import { useAuth } from "../context/AuthContext";

const CATEGORIES: { value: AssetCategoryDto; label: string }[] = [
  { value: "IT", label: "Peralatan TI / Komputer" },
  { value: "FRN", label: "Furnitur / Mebel" },
  { value: "ELK", label: "Elektronik" },
  { value: "LAB", label: "Laboratorium" },
  { value: "LIB", label: "Pustaka / Buku" },
  { value: "SPT", label: "Olahraga" },
  { value: "EDU", label: "Alat Edukatif" },
  { value: "OFF", label: "Kantor" },
  { value: "OTH", label: "Lainnya" },
];

const FUNDING_SOURCES: { value: FundingSourceDto; label: string }[] = [
  { value: "BOS", label: "BOS (ARKAS)" },
  { value: "BOP", label: "BOP" },
  { value: "YAYASAN", label: "Yayasan" },
  { value: "KOMITE", label: "Komite Sekolah" },
  { value: "HIBAH", label: "Hibah / Donasi" },
  { value: "LAINNYA", label: "Lainnya" },
];

const CONDITIONS: { value: AssetConditionDto; label: string; variant: "success" | "warning" | "destructive" }[] = [
  { value: "BAIK", label: "Baik", variant: "success" },
  { value: "RUSAK_RINGAN", label: "Rusak Ringan", variant: "warning" },
  { value: "RUSAK_BERAT", label: "Rusak Berat", variant: "destructive" },
];

function formatRupiah(amount: number | null): string {
  if (amount == null) return "-";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);
}

export default function InventoryManagement() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canManage = can("manage_inventory");
  const canExport = can("export_inventory");

  // Filter state
  const [search, setSearch] = useState("");
  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedFunding, setSelectedFunding] = useState<string>("");
  const [selectedCondition, setSelectedCondition] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ACTIVE");
  const [budgetYear, setBudgetYear] = useState<string>("");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // Selection for batch operations / label printing
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());

  // Modal states
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetDtoType | null>(null);
  const [retiringAsset, setRetiringAsset] = useState<AssetDtoType | null>(null);
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);

  // School units query
  const schoolUnitsQuery = useQuery({
    queryKey: ["staff", "school-units"],
    queryFn: fetchSchoolUnits,
  });

  const queryParams = useMemo(() => {
    const p: Record<string, any> = {
      limit: String(pageSize),
      offset: String(page * pageSize),
    };
    if (search.trim()) p.search = search.trim();
    if (selectedUnit) p.school_unit_id = selectedUnit;
    if (selectedCategory) p.category = selectedCategory;
    if (selectedFunding) p.funding_source = selectedFunding;
    if (selectedCondition) p.condition = selectedCondition;
    if (selectedStatus) p.status = selectedStatus;
    if (budgetYear) p.budget_year = budgetYear;
    return p;
  }, [search, selectedUnit, selectedCategory, selectedFunding, selectedCondition, selectedStatus, budgetYear, page]);

  const assetsQuery = useQuery({
    queryKey: queryKeys.inventory.list(queryParams),
    queryFn: () => fetchAssets(queryParams),
  });

  const assets = assetsQuery.data?.items ?? [];
  const totalAssets = assetsQuery.data?.total ?? 0;
  const totalPages = Math.ceil(totalAssets / pageSize);

  const toggleSelectAll = () => {
    if (selectedAssetIds.size === assets.length && assets.length > 0) {
      setSelectedAssetIds(new Set());
    } else {
      setSelectedAssetIds(new Set(assets.map((a) => a.id)));
    }
  };

  const toggleSelectAsset = (id: string) => {
    const next = new Set(selectedAssetIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedAssetIds(next);
  };

  const handleExportXlsx = async () => {
    try {
      const blob = await downloadInventoryXlsx(queryParams);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inventaris-aset-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Gagal mengunduh file Excel: " + (err instanceof Error ? err.message : "Kesalahan sistem"));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Inventaris & Label Aset"
        description="Buku inventaris aset sekolah untuk pengadaan dana BOS/ARKAS, Yayasan, dan Hibah, dilengkapi pencetakan label stiker presisi."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManage && (
              <>
                <Button onClick={() => setIsRegisterOpen(true)} className="gap-1.5">
                  <Plus className="size-4" />
                  Tambah Aset
                </Button>
                <Button onClick={() => setIsBatchOpen(true)} variant="outline" className="gap-1.5">
                  <Layers className="size-4" />
                  Tambah Massal
                </Button>
              </>
            )}
            <Button
              onClick={() => setIsLabelModalOpen(true)}
              variant="outline"
              disabled={selectedAssetIds.size === 0 && assets.length === 0}
              className="gap-1.5"
            >
              <Printer className="size-4" />
              Cetak Label {selectedAssetIds.size > 0 ? `(${selectedAssetIds.size})` : ""}
            </Button>
            {canExport && (
              <Button onClick={handleExportXlsx} variant="outline" className="gap-1.5">
                <FileSpreadsheet className="size-4" />
                Ekspor Excel
              </Button>
            )}
          </div>
        }
      />

      {/* Filter and Search Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
            <div className="lg:col-span-2">
              <Label htmlFor="search-input" className="text-xs font-semibold text-muted-foreground">Pencarian</Label>
              <div className="relative mt-1">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  id="search-input"
                  placeholder="Nama, kode, merk, lokasi..."
                  className="pl-8 text-sm"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="unit-select" className="text-xs font-semibold text-muted-foreground">Unit Sekolah</Label>
              <select
                id="unit-select"
                aria-label="Filter Unit Sekolah"
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={selectedUnit}
                onChange={(e) => {
                  setSelectedUnit(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">Semua Unit</option>
                {schoolUnitsQuery.data?.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="category-select" className="text-xs font-semibold text-muted-foreground">Kategori</Label>
              <select
                id="category-select"
                aria-label="Filter Kategori"
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">Semua Kategori</option>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="funding-select" className="text-xs font-semibold text-muted-foreground">Sumber Dana</Label>
              <select
                id="funding-select"
                aria-label="Filter Sumber Dana"
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={selectedFunding}
                onChange={(e) => {
                  setSelectedFunding(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">Semua Sumber</option>
                {FUNDING_SOURCES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="condition-select" className="text-xs font-semibold text-muted-foreground">Kondisi</Label>
              <select
                id="condition-select"
                aria-label="Filter Kondisi"
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={selectedCondition}
                onChange={(e) => {
                  setSelectedCondition(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">Semua Kondisi</option>
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="status-select" className="text-xs font-semibold text-muted-foreground">Status</Label>
              <select
                id="status-select"
                aria-label="Filter Status"
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={selectedStatus}
                onChange={(e) => {
                  setSelectedStatus(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">Semua Status</option>
                <option value="ACTIVE">Aktif</option>
                <option value="RETIRED">Dihapusbukukan</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Asset Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b px-6 py-4">
          <CardTitle className="text-base font-semibold">
            Daftar Aset ({totalAssets} barang)
          </CardTitle>
          {selectedAssetIds.size > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{selectedAssetIds.size} barang terpilih</span>
              <Button size="sm" variant="ghost" onClick={() => setSelectedAssetIds(new Set())}>
                Batal Pilih
              </Button>
            </div>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {assetsQuery.isPending ? (
            <LoadingState message="Memuat buku inventaris aset…" />
          ) : assetsQuery.isError ? (
            <ErrorState message={getPageApiError(assetsQuery.error, "Gagal memuat inventaris aset.")} />
          ) : assets.length === 0 ? (
            <EmptyState
              title="Belum ada data aset"
              description="Daftarkan barang atau aset sekolah dengan tombol Tambah Aset di atas."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs font-medium uppercase text-muted-foreground">
                  <tr>
                    <th className="w-10 px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        aria-label="Pilih semua baris aset"
                        className="rounded border-gray-300"
                        checked={selectedAssetIds.size === assets.length && assets.length > 0}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="px-4 py-3">Kode Aset</th>
                    <th className="px-4 py-3">Nama Barang</th>
                    <th className="px-4 py-3">Kategori</th>
                    <th className="px-4 py-3">Unit</th>
                    <th className="px-4 py-3">Merk / Lokasi</th>
                    <th className="px-4 py-3">Sumber / Tahun</th>
                    <th className="px-4 py-3 text-right">Harga</th>
                    <th className="px-4 py-3">Kondisi</th>
                    <th className="px-4 py-3">Status</th>
                    {canManage && <th className="px-4 py-3 text-center">Aksi</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {assets.map((asset) => {
                    const isSelected = selectedAssetIds.has(asset.id);
                    const cond = CONDITIONS.find((c) => c.value === asset.condition);
                    const isRetired = asset.status === "RETIRED";

                    return (
                      <tr
                        key={asset.id}
                        className={`transition-colors hover:bg-muted/30 ${isSelected ? "bg-muted/40" : ""} ${isRetired ? "opacity-75" : ""}`}
                      >
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            aria-label={`Pilih aset ${asset.asset_code}`}
                            className="rounded border-gray-300"
                            checked={isSelected}
                            onChange={() => toggleSelectAsset(asset.id)}
                          />
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold text-primary">
                          {asset.asset_code}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{asset.item_name}</div>
                          {asset.notes && (
                            <div className="text-xs text-muted-foreground">{asset.notes}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-xs font-normal">
                            {CATEGORIES.find((c) => c.value === asset.category)?.label ?? asset.category}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {asset.school_unit_name}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div>{asset.brand || "-"}</div>
                          <div className="text-muted-foreground">{asset.location || "-"}</div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div>{asset.funding_source}</div>
                          <div className="text-muted-foreground">{asset.budget_year}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-mono">
                          {formatRupiah(asset.price)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={cond?.variant ?? "secondary"} className="text-xs">
                            {cond?.label ?? asset.condition}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {isRetired ? (
                            <Badge variant="secondary" className="text-xs bg-slate-200 text-slate-800">
                              Dihapus
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs border-emerald-500 text-emerald-700">
                              Aktif
                            </Badge>
                          )}
                        </td>
                        {canManage && (
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {!isRetired && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0"
                                    title="Edit data aset"
                                    onClick={() => setEditingAsset(asset)}
                                  >
                                    <Edit2 className="size-3.5" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                                    title="Hapusbuku / Berhentikan aset"
                                    onClick={() => setRetiringAsset(asset)}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-6 py-3">
              <span className="text-xs text-muted-foreground">
                Halaman {page + 1} dari {totalPages} ({totalAssets} total aset)
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(p - 1, 0))}
                >
                  Sebelumnya
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Berikutnya
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Single Asset Register Modal */}
      {isRegisterOpen && (
        <AssetRegisterModal
          schoolUnits={schoolUnitsQuery.data ?? []}
          onClose={() => setIsRegisterOpen(false)}
          onSuccess={() => {
            setIsRegisterOpen(false);
            queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
          }}
        />
      )}

      {/* Batch Asset Register Modal */}
      {isBatchOpen && (
        <AssetBatchRegisterModal
          schoolUnits={schoolUnitsQuery.data ?? []}
          onClose={() => setIsBatchOpen(false)}
          onSuccess={() => {
            setIsBatchOpen(false);
            queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
          }}
        />
      )}

      {/* Edit Asset Modal */}
      {editingAsset && (
        <AssetEditModal
          asset={editingAsset}
          onClose={() => setEditingAsset(null)}
          onSuccess={() => {
            setEditingAsset(null);
            queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
          }}
        />
      )}

      {/* Retire Asset Modal */}
      {retiringAsset && (
        <AssetRetireModal
          asset={retiringAsset}
          onClose={() => setRetiringAsset(null)}
          onSuccess={() => {
            setRetiringAsset(null);
            queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
          }}
        />
      )}

      {/* Print Labels Modal */}
      {isLabelModalOpen && (
        <LabelPrintModal
          selectedIds={Array.from(selectedAssetIds.size > 0 ? selectedAssetIds : assets.map((a) => a.id))}
          onClose={() => setIsLabelModalOpen(false)}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Modals
// -------------------------------------------------------------

function AssetRegisterModal({
  schoolUnits,
  onClose,
  onSuccess,
}: {
  schoolUnits: Array<{ id: number; name: string }>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [unitId, setUnitId] = useState<number>(schoolUnits[0]?.id ?? 1);
  const [category, setCategory] = useState<AssetCategoryDto>("IT");
  const [itemName, setItemName] = useState("");
  const [brand, setBrand] = useState("");
  const [location, setLocation] = useState("");
  const [fundingSource, setFundingSource] = useState<FundingSourceDto>("BOS");
  const [budgetYear, setBudgetYear] = useState<number>(new Date().getFullYear());
  const [acquisitionDate, setAcquisitionDate] = useState(new Date().toISOString().slice(0, 10));
  const [price, setPrice] = useState<string>("");
  const [condition, setCondition] = useState<AssetConditionDto>("BAIK");
  const [notes, setNotes] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const createMutation = useMutation({
    mutationFn: createAsset,
    onSuccess,
    onError: (err) => setErrorMsg(getPageApiError(err, "Gagal mendaftarkan aset.")),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim()) {
      setErrorMsg("Nama barang wajib diisi.");
      return;
    }
    setErrorMsg("");
    createMutation.mutate({
      school_unit_id: unitId,
      category,
      item_name: itemName.trim(),
      brand: brand.trim() || undefined,
      location: location.trim() || undefined,
      funding_source: fundingSource,
      budget_year: Number(budgetYear),
      acquisition_date: acquisitionDate || undefined,
      price: price ? Number(price) : undefined,
      condition,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Tambah Aset Baru</DialogTitle>
          <DialogDescription>
            Nomor kode aset unik akan otomatis dialokasikan sesuai unit sekolah dan kategori yang dipilih.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMsg && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{errorMsg}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="reg-unit">Unit Sekolah</Label>
              <select
                id="reg-unit"
                aria-label="Pilih Unit Sekolah"
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={unitId}
                onChange={(e) => setUnitId(Number(e.target.value))}
              >
                {schoolUnits.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="reg-cat">Kategori</Label>
              <select
                id="reg-cat"
                aria-label="Pilih Kategori Aset"
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value as AssetCategoryDto)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="reg-name">Nama Barang *</Label>
            <Input
              id="reg-name"
              placeholder="Contoh: Laptop Guru Core i5"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="reg-brand">Merk / Model</Label>
              <Input
                id="reg-brand"
                placeholder="Contoh: ASUS Vivobook 14"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="reg-loc">Lokasi / Ruangan</Label>
              <Input
                id="reg-loc"
                placeholder="Contoh: Lab Komputer"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="reg-fund">Sumber Dana</Label>
              <select
                id="reg-fund"
                aria-label="Pilih Sumber Dana"
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={fundingSource}
                onChange={(e) => setFundingSource(e.target.value as FundingSourceDto)}
              >
                {FUNDING_SOURCES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="reg-year">Tahun Anggaran</Label>
              <Input
                id="reg-year"
                type="number"
                min="2000"
                max="2100"
                value={budgetYear}
                onChange={(e) => setBudgetYear(Number(e.target.value))}
              />
            </div>

            <div>
              <Label htmlFor="reg-price">Harga (Rp)</Label>
              <Input
                id="reg-price"
                type="number"
                placeholder="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="reg-date">Tanggal Perolehan</Label>
              <Input
                id="reg-date"
                type="date"
                value={acquisitionDate}
                onChange={(e) => setAcquisitionDate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="reg-cond">Kondisi</Label>
              <select
                id="reg-cond"
                aria-label="Pilih Kondisi Barang"
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={condition}
                onChange={(e) => setCondition(e.target.value as AssetConditionDto)}
              >
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="reg-notes">Catatan Tambahan</Label>
            <Textarea
              id="reg-notes"
              placeholder="Keterangan pengadaan, nomor seri pabrik, dsb."
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Menyimpan…" : "Simpan Aset"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssetBatchRegisterModal({
  schoolUnits,
  onClose,
  onSuccess,
}: {
  schoolUnits: Array<{ id: number; name: string }>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [unitId, setUnitId] = useState<number>(schoolUnits[0]?.id ?? 1);
  const [category, setCategory] = useState<AssetCategoryDto>("FRN");
  const [quantity, setQuantity] = useState<number>(10);
  const [itemName, setItemName] = useState("");
  const [brand, setBrand] = useState("");
  const [location, setLocation] = useState("");
  const [fundingSource, setFundingSource] = useState<FundingSourceDto>("BOS");
  const [budgetYear, setBudgetYear] = useState<number>(new Date().getFullYear());
  const [pricePerUnit, setPricePerUnit] = useState<string>("");
  const [condition, setCondition] = useState<AssetConditionDto>("BAIK");
  const [notes, setNotes] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const batchMutation = useMutation({
    mutationFn: batchCreateAssets,
    onSuccess,
    onError: (err) => setErrorMsg(getPageApiError(err, "Gagal mendaftarkan aset massal.")),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim()) {
      setErrorMsg("Nama barang wajib diisi.");
      return;
    }
    if (quantity < 1 || quantity > 100) {
      setErrorMsg("Jumlah barang harus antara 1 dan 100.");
      return;
    }
    setErrorMsg("");
    batchMutation.mutate({
      school_unit_id: unitId,
      category,
      item_name: itemName.trim(),
      quantity: Number(quantity),
      brand: brand.trim() || undefined,
      location: location.trim() || undefined,
      funding_source: fundingSource,
      budget_year: Number(budgetYear),
      price_per_unit: pricePerUnit ? Number(pricePerUnit) : undefined,
      condition,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Pendaftaran Aset Massal (Batch)</DialogTitle>
          <DialogDescription>
            Daftarkan kelompok barang identik (misal: 20 Meja Siswa). Sistem akan mengalokasikan nomor kode berurutan secara otomatis tanpa celah.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMsg && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{errorMsg}</div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="batch-unit">Unit Sekolah</Label>
              <select
                id="batch-unit"
                aria-label="Pilih Unit Sekolah"
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={unitId}
                onChange={(e) => setUnitId(Number(e.target.value))}
              >
                {schoolUnits.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="batch-cat">Kategori</Label>
              <select
                id="batch-cat"
                aria-label="Pilih Kategori Aset"
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value as AssetCategoryDto)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="batch-qty">Jumlah Unit (1-100) *</Label>
              <Input
                id="batch-qty"
                type="number"
                min="1"
                max="100"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="batch-name">Nama Barang *</Label>
            <Input
              id="batch-name"
              placeholder="Contoh: Kursi Siswa Standar"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="batch-brand">Merk / Model</Label>
              <Input
                id="batch-brand"
                placeholder="Contoh: Informa School"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="batch-loc">Lokasi Awal</Label>
              <Input
                id="batch-loc"
                placeholder="Contoh: Ruang Kelas 1"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="batch-fund">Sumber Dana</Label>
              <select
                id="batch-fund"
                aria-label="Pilih Sumber Dana"
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={fundingSource}
                onChange={(e) => setFundingSource(e.target.value as FundingSourceDto)}
              >
                {FUNDING_SOURCES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="batch-year">Tahun Anggaran</Label>
              <Input
                id="batch-year"
                type="number"
                min="2000"
                max="2100"
                value={budgetYear}
                onChange={(e) => setBudgetYear(Number(e.target.value))}
              />
            </div>

            <div>
              <Label htmlFor="batch-price">Harga Satuan (Rp)</Label>
              <Input
                id="batch-price"
                type="number"
                placeholder="0"
                value={pricePerUnit}
                onChange={(e) => setPricePerUnit(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={batchMutation.isPending}>
              {batchMutation.isPending ? `Mendaftarkan ${quantity} Aset…` : `Daftarkan ${quantity} Aset`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssetEditModal({
  asset,
  onClose,
  onSuccess,
}: {
  asset: AssetDtoType;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [itemName, setItemName] = useState(asset.item_name);
  const [brand, setBrand] = useState(asset.brand ?? "");
  const [location, setLocation] = useState(asset.location ?? "");
  const [fundingSource, setFundingSource] = useState<FundingSourceDto>(asset.funding_source);
  const [budgetYear, setBudgetYear] = useState<number>(asset.budget_year);
  const [acquisitionDate, setAcquisitionDate] = useState(asset.acquisition_date ?? "");
  const [price, setPrice] = useState<string>(asset.price != null ? String(asset.price) : "");
  const [condition, setCondition] = useState<AssetConditionDto>(asset.condition);
  const [notes, setNotes] = useState(asset.notes ?? "");
  const [errorMsg, setErrorMsg] = useState("");

  const updateMutation = useMutation({
    mutationFn: (body: UpdateAssetRequestDto) => updateAsset(asset.id, body),
    onSuccess,
    onError: (err) => setErrorMsg(getPageApiError(err, "Gagal memperbarui data aset.")),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim()) {
      setErrorMsg("Nama barang wajib diisi.");
      return;
    }
    setErrorMsg("");
    updateMutation.mutate({
      item_name: itemName.trim(),
      brand: brand.trim() || null,
      location: location.trim() || null,
      funding_source: fundingSource,
      budget_year: Number(budgetYear),
      acquisition_date: acquisitionDate || null,
      price: price ? Number(price) : null,
      condition,
      notes: notes.trim() || null,
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Data Aset</DialogTitle>
          <DialogDescription>
            Kode aset ({asset.asset_code}) dan unit asal ({asset.school_unit_name}) bersifat permanen dan tidak dapat diubah.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMsg && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{errorMsg}</div>
          )}

          <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/40 p-3 text-xs">
            <div>
              <span className="font-semibold text-muted-foreground">Kode Aset:</span>
              <div className="font-mono font-bold text-primary">{asset.asset_code}</div>
            </div>
            <div>
              <span className="font-semibold text-muted-foreground">Unit Sekolah:</span>
              <div className="font-medium">{asset.school_unit_name}</div>
            </div>
          </div>

          <div>
            <Label htmlFor="edit-name">Nama Barang *</Label>
            <Input
              id="edit-name"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-brand">Merk / Model</Label>
              <Input
                id="edit-brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit-loc">Lokasi / Ruangan</Label>
              <Input
                id="edit-loc"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="edit-fund">Sumber Dana</Label>
              <select
                id="edit-fund"
                aria-label="Pilih Sumber Dana"
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={fundingSource}
                onChange={(e) => setFundingSource(e.target.value as FundingSourceDto)}
              >
                {FUNDING_SOURCES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="edit-year">Tahun Anggaran</Label>
              <Input
                id="edit-year"
                type="number"
                min="2000"
                max="2100"
                value={budgetYear}
                onChange={(e) => setBudgetYear(Number(e.target.value))}
              />
            </div>

            <div>
              <Label htmlFor="edit-price">Harga (Rp)</Label>
              <Input
                id="edit-price"
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-cond">Kondisi</Label>
              <select
                id="edit-cond"
                aria-label="Pilih Kondisi Barang"
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={condition}
                onChange={(e) => setCondition(e.target.value as AssetConditionDto)}
              >
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="edit-date">Tanggal Perolehan</Label>
              <Input
                id="edit-date"
                type="date"
                value={acquisitionDate}
                onChange={(e) => setAcquisitionDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="edit-notes">Catatan</Label>
            <Textarea
              id="edit-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Menyimpan…" : "Perbarui"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssetRetireModal({
  asset,
  onClose,
  onSuccess,
}: {
  asset: AssetDtoType;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState("");
  const [retiredAt, setRetiredAt] = useState(new Date().toISOString().slice(0, 10));
  const [errorMsg, setErrorMsg] = useState("");

  const retireMutation = useMutation({
    mutationFn: () => retireAsset(asset.id, { retired_reason: reason.trim(), retired_at: retiredAt }),
    onSuccess,
    onError: (err) => setErrorMsg(getPageApiError(err, "Gagal menghapusbukukan aset.")),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setErrorMsg("Alasan penghapusan buku wajib diisi.");
      return;
    }
    setErrorMsg("");
    retireMutation.mutate();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" />
            Penghapusan / Pembebasan Aset
          </DialogTitle>
          <DialogDescription>
            Aset ini akan diubah statusnya menjadi <strong>DIHAPUSBUKUKAN (RETIRED)</strong>. Riwayat dan nomor kode aset tetap tersimpan secara permanen untuk audit.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMsg && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{errorMsg}</div>
          )}

          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <div className="font-semibold text-foreground">{asset.item_name}</div>
            <div className="font-mono text-xs text-muted-foreground">{asset.asset_code} · {asset.school_unit_name}</div>
          </div>

          <div>
            <Label htmlFor="ret-date">Tanggal Penghapusan</Label>
            <Input
              id="ret-date"
              type="date"
              value={retiredAt}
              onChange={(e) => setRetiredAt(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="ret-reason">Alasan Penghapusan Buku *</Label>
            <Textarea
              id="ret-reason"
              placeholder="Contoh: Rusak berat akibat konsleting listrik, tidak ekonomis untuk diperbaiki."
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" variant="destructive" disabled={retireMutation.isPending}>
              {retireMutation.isPending ? "Memproses…" : "Hapusbukukan Aset"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LabelPrintModal({
  selectedIds,
  onClose,
}: {
  selectedIds: string[];
  onClose: () => void;
}) {
  const [templateId, setTemplateId] = useState<LabelTemplateIdDto>("103");
  const [startingIndex, setStartingIndex] = useState<number>(0);
  const [offsetX, setOffsetX] = useState<number>(0);
  const [offsetY, setOffsetY] = useState<number>(0);
  const [monochrome, setMonochrome] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const totalSlots = templateId === "103" ? 12 : 30;
  const cols = 3;
  const rows = templateId === "103" ? 4 : 10;

  const handlePrint = async () => {
    setIsGenerating(true);
    setErrorMsg("");
    try {
      const blob = await downloadLabelsPdf({
        asset_ids: selectedIds,
        template_id: templateId,
        starting_index: startingIndex,
        offset_x_mm: offsetX,
        offset_y_mm: offsetY,
        monochrome,
      });

      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (err) {
      setErrorMsg(getPageApiError(err, "Gagal membuat dokumen PDF label."));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="size-5 text-primary" />
            Cetak Label Stiker Presisi
          </DialogTitle>
          <DialogDescription>
            Pilih jenis lembar stiker, tentukan posisi awal cetak (untuk memanfaatkan sisa lembar), dan cetak melalui mesin PDF server.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {errorMsg && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{errorMsg}</div>
          )}

          {/* Template Selection */}
          <div className="grid grid-cols-2 gap-3">
            <div
              className={`cursor-pointer rounded-lg border p-3.5 transition-all ${templateId === "103" ? "border-primary bg-primary/5 ring-2 ring-primary" : "border-border hover:bg-muted/30"}`}
              onClick={() => {
                setTemplateId("103");
                if (startingIndex >= 12) setStartingIndex(0);
              }}
            >
              <div className="font-semibold text-foreground">Labelindo No. 103</div>
              <div className="text-xs text-muted-foreground">64 × 32 mm · 12 label/lembar (3 × 4)</div>
              <Badge variant="outline" className="mt-2 text-[10px]">Ukuran Standar Lega</Badge>
            </div>

            <div
              className={`cursor-pointer rounded-lg border p-3.5 transition-all ${templateId === "107" ? "border-primary bg-primary/5 ring-2 ring-primary" : "border-border hover:bg-muted/30"}`}
              onClick={() => setTemplateId("107")}
            >
              <div className="font-semibold text-foreground">Labelindo No. 107</div>
              <div className="text-xs text-muted-foreground">50 × 18 mm · 30 label/lembar (3 × 10)</div>
              <Badge variant="outline" className="mt-2 text-[10px]">Ukuran Kompak</Badge>
            </div>
          </div>

          {/* Visual Starting Position Picker */}
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">
                Posisi Awal Stiker (Klik slot untuk mulai cetak dari posisi tersebut):
              </Label>
              <span className="text-xs font-mono text-muted-foreground">
                Slot #{startingIndex + 1}
              </span>
            </div>

            <div
              className="mt-2 grid gap-1.5 rounded-md border bg-muted/20 p-2.5"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              }}
            >
              {Array.from({ length: totalSlots }).map((_, index) => {
                const isSkipped = index < startingIndex;
                const isTarget = index >= startingIndex && index < startingIndex + selectedIds.length;

                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setStartingIndex(index)}
                    className={`flex h-9 items-center justify-center rounded border text-xs font-mono transition-all ${
                      index === startingIndex
                        ? "border-primary bg-primary font-bold text-primary-foreground shadow"
                        : isSkipped
                        ? "border-dashed border-muted-foreground/30 bg-muted/60 text-muted-foreground"
                        : isTarget
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border bg-background hover:border-primary/40"
                    }`}
                  >
                    {isSkipped ? "Lewati" : `#${index + 1}`}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Slot yang dilewati akan dibiarkan kosong pada lembar pertama, sehingga sisa lembar stiker bekas dapat digunakan kembali tanpa terbuang.
            </p>
          </div>

          {/* Precision Calibration Offsets */}
          <div className="rounded-lg border bg-muted/10 p-3">
            <div className="text-xs font-semibold text-foreground">Kalibrasi Margin Printer (Milimeter)</div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="offset-x" className="text-xs text-muted-foreground">Geser Horizontal (mm)</Label>
                <Input
                  id="offset-x"
                  type="number"
                  step="0.5"
                  className="mt-1 h-8 text-xs"
                  placeholder="0.0"
                  value={offsetX}
                  onChange={(e) => setOffsetX(Number(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="offset-y" className="text-xs text-muted-foreground">Geser Vertikal (mm)</Label>
                <Input
                  id="offset-y"
                  type="number"
                  step="0.5"
                  className="mt-1 h-8 text-xs"
                  placeholder="0.0"
                  value={offsetY}
                  onChange={(e) => setOffsetY(Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mono-toggle"
              checked={monochrome}
              onChange={(e) => setMonochrome(e.target.checked)}
              className="rounded border-gray-300"
            />
            <Label htmlFor="mono-toggle" className="cursor-pointer text-xs">
              Mode Hemat Tinta (Cetak hitam-putih / monokrom murni)
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={handlePrint} disabled={isGenerating} className="gap-1.5">
            <Printer className="size-4" />
            {isGenerating ? "Menyiapkan PDF Presisi…" : `Buka & Cetak PDF (${selectedIds.length} label)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
