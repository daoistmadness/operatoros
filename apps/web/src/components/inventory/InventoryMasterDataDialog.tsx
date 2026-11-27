import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InventoryMasterEntryDto, InventoryMasterDataResponseDto } from "@operatoros/contracts/inventory";
import {
  createAssetCategory,
  createFundingSource,
  deleteAssetCategory,
  deleteFundingSource,
  reorderAssetCategories,
  reorderFundingSources,
  updateAssetCategory,
  updateFundingSource,
} from "../../api/inventory";
import { getPageApiError } from "../../lib/api/errors";
import { queryKeys } from "../../lib/query/queryKeys";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

type MasterKind = "category" | "funding";

function InventoryMasterDataRow({
  entry,
  kind,
  index,
  count,
  busy,
  onSave,
  onToggleActive,
  onMove,
  onDelete,
}: {
  entry: InventoryMasterEntryDto;
  kind: MasterKind;
  index: number;
  count: number;
  busy: boolean;
  onSave: (name: string) => void;
  onToggleActive: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(entry.name);
  useEffect(() => setName(entry.name), [entry.name]);

  return (
    <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono font-semibold">{entry.code}</span>
          {!entry.is_active && <span className="rounded bg-muted px-1.5 py-0.5">Nonaktif</span>}
        </div>
        <div className="flex gap-2">
          <Input
            aria-label={`Nama ${kind === "category" ? "kategori" : "sumber dana"} ${entry.code}`}
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || name.trim() === entry.name || name.trim().length === 0}
            onClick={() => onSave(name)}
          >
            Simpan
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" variant="ghost" aria-label={`Naikkan ${entry.name}`} disabled={busy || index === 0} onClick={() => onMove(-1)}>↑</Button>
        <Button size="sm" variant="ghost" aria-label={`Turunkan ${entry.name}`} disabled={busy || index === count - 1} onClick={() => onMove(1)}>↓</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onToggleActive}>
          {entry.is_active ? "Nonaktifkan" : "Aktifkan"}
        </Button>
        <Button size="sm" variant="danger" disabled={busy || !entry.can_delete} onClick={onDelete}>
          Hapus
        </Button>
      </div>
      {!entry.can_delete && (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          {kind === "category" ? "Kategori memiliki aset atau riwayat nomor urut." : "Sumber dana sudah digunakan aset."} Tidak dapat dihapus.
        </p>
      )}
    </div>
  );
}

export function InventoryMasterDataDialog({
  data,
  isPending,
  isError,
  loadError,
  onClose,
}: {
  data: InventoryMasterDataResponseDto | undefined;
  isPending: boolean;
  isError: boolean;
  loadError: unknown;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [categoryCode, setCategoryCode] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [fundingName, setFundingName] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    setError("");
    await queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
  };
  const showError = (cause: unknown) => setError(getPageApiError(cause, "Gagal menyimpan data master inventaris."));
  const createCategoryMutation = useMutation({
    mutationFn: createAssetCategory,
    onSuccess: async () => { setCategoryCode(""); setCategoryName(""); await refresh(); },
    onError: showError,
  });
  const createFundingMutation = useMutation({
    mutationFn: createFundingSource,
    onSuccess: async () => { setFundingName(""); await refresh(); },
    onError: showError,
  });
  const updateCategoryMutation = useMutation({
    mutationFn: ({ code, name, is_active }: { code: string; name?: string; is_active?: boolean }) => updateAssetCategory(code, {
      ...(name === undefined ? {} : { name }),
      ...(is_active === undefined ? {} : { is_active }),
    }),
    onSuccess: refresh,
    onError: showError,
  });
  const updateFundingMutation = useMutation({
    mutationFn: ({ code, name, is_active }: { code: string; name?: string; is_active?: boolean }) => updateFundingSource(code, {
      ...(name === undefined ? {} : { name }),
      ...(is_active === undefined ? {} : { is_active }),
    }),
    onSuccess: refresh,
    onError: showError,
  });
  const reorderCategoryMutation = useMutation({ mutationFn: reorderAssetCategories, onSuccess: refresh, onError: showError });
  const reorderFundingMutation = useMutation({ mutationFn: reorderFundingSources, onSuccess: refresh, onError: showError });
  const deleteCategoryMutation = useMutation({ mutationFn: deleteAssetCategory, onSuccess: refresh, onError: showError });
  const deleteFundingMutation = useMutation({ mutationFn: deleteFundingSource, onSuccess: refresh, onError: showError });

  const categories = data?.categories ?? [];
  const fundingSources = data?.funding_sources ?? [];
  const busy =
    createCategoryMutation.isPending ||
    createFundingMutation.isPending ||
    updateCategoryMutation.isPending ||
    updateFundingMutation.isPending ||
    reorderCategoryMutation.isPending ||
    reorderFundingMutation.isPending ||
    deleteCategoryMutation.isPending ||
    deleteFundingMutation.isPending;

  const move = (kind: MasterKind, index: number, direction: -1 | 1) => {
    const entries = kind === "category" ? categories : fundingSources;
    const next = [...entries];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    const body = { codes: next.map((entry) => entry.code) };
    if (kind === "category") reorderCategoryMutation.mutate(body);
    else reorderFundingMutation.mutate(body);
  };

  const onCreateCategory = (event: React.FormEvent) => {
    event.preventDefault();
    if (!categoryCode.trim() || !categoryName.trim()) return;
    createCategoryMutation.mutate({ code: categoryCode.trim().toUpperCase(), name: categoryName });
  };
  const onCreateFunding = (event: React.FormEvent) => {
    event.preventDefault();
    if (!fundingName.trim()) return;
    createFundingMutation.mutate({ name: fundingName });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Kelola Data Inventaris</DialogTitle>
          <DialogDescription>
            Perubahan berlaku untuk seluruh unit sekolah. Kode kategori dan kode sumber dana yang sudah digunakan tetap permanen.
          </DialogDescription>
        </DialogHeader>

        {(error || isError) && (
          <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error || getPageApiError(loadError, "Gagal memuat data master inventaris.")}
          </div>
        )}
        {isPending ? <p className="text-sm text-muted-foreground">Memuat data master…</p> : (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-3" aria-labelledby="asset-categories-title">
              <div>
                <h3 id="asset-categories-title" className="text-base font-bold">Kategori Aset</h3>
                <p className="text-xs text-muted-foreground">Kode kategori menjadi bagian dari kode aset yang akan dibuat.</p>
              </div>
              <form className="grid gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto]" onSubmit={onCreateCategory}>
                <div>
                  <Label htmlFor="new-category-code">Kode</Label>
                  <Input
                    id="new-category-code"
                    aria-label="Kode kategori baru"
                    maxLength={8}
                    pattern="[A-Z0-9]{2,8}"
                    value={categoryCode}
                    onChange={(event) => setCategoryCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                    disabled={busy}
                  />
                </div>
                <div>
                  <Label htmlFor="new-category-name">Nama</Label>
                  <Input
                    id="new-category-name"
                    aria-label="Nama kategori baru"
                    maxLength={80}
                    value={categoryName}
                    onChange={(event) => setCategoryName(event.target.value)}
                    disabled={busy}
                  />
                </div>
                <Button type="submit" className="self-end" disabled={busy || !categoryCode.trim() || !categoryName.trim()}>Tambah</Button>
              </form>
              <div className="space-y-2">
                {categories.map((entry, index) => (
                  <InventoryMasterDataRow
                    key={entry.code}
                    entry={entry}
                    kind="category"
                    index={index}
                    count={categories.length}
                    busy={busy}
                    onSave={(name) => updateCategoryMutation.mutate({ code: entry.code, name })}
                    onToggleActive={() => updateCategoryMutation.mutate({ code: entry.code, is_active: !entry.is_active })}
                    onMove={(direction) => move("category", index, direction)}
                    onDelete={() => deleteCategoryMutation.mutate(entry.code)}
                  />
                ))}
              </div>
            </section>

            <section className="space-y-3" aria-labelledby="funding-sources-title">
              <div>
                <h3 id="funding-sources-title" className="text-base font-bold">Sumber Dana</h3>
                <p className="text-xs text-muted-foreground">Sumber dana tambahan tidak mengubah validasi khusus BOS/ARKAS.</p>
              </div>
              <form className="grid gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={onCreateFunding}>
                <div>
                  <Label htmlFor="new-funding-name">Nama</Label>
                  <Input
                    id="new-funding-name"
                    aria-label="Nama sumber dana baru"
                    maxLength={80}
                    value={fundingName}
                    onChange={(event) => setFundingName(event.target.value)}
                    disabled={busy}
                  />
                </div>
                <Button type="submit" className="self-end" disabled={busy || !fundingName.trim()}>Tambah</Button>
              </form>
              <div className="space-y-2">
                {fundingSources.map((entry, index) => (
                  <InventoryMasterDataRow
                    key={entry.code}
                    entry={entry}
                    kind="funding"
                    index={index}
                    count={fundingSources.length}
                    busy={busy}
                    onSave={(name) => updateFundingMutation.mutate({ code: entry.code, name })}
                    onToggleActive={() => updateFundingMutation.mutate({ code: entry.code, is_active: !entry.is_active })}
                    onMove={(direction) => move("funding", index, direction)}
                    onDelete={() => deleteFundingMutation.mutate(entry.code)}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
