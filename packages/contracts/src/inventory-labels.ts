export type LabelTemplateFamily = "manufacturer" | "standard_paper";
export type LabelPageOrientation = "portrait" | "landscape";
export type LabelContentPreset = "standard" | "compact";
export type LabelGeometryVerificationStatus =
  | "verified_pdf_provisional_physical"
  | "verified_standard_paper"
  | "calibrated";

export interface LabelSlotPosition {
  index: number;
  row: number;
  col: number;
  xMm: number;
  yTopMm: number;
  widthMm: number;
  heightMm: number;
}

export interface GridLayoutSpec {
  minMarginXMm: number;
  minMarginYMm: number;
  gapXMm: number;
  gapYMm: number;
}

export interface ExplicitGridSpec {
  colXMm: readonly number[];
  rowYTopMm: readonly number[];
}

export interface LabelTemplateDefinition {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  family: LabelTemplateFamily;
  manufacturer?: string;
  productNumber?: string;
  referenceUrl?: string;
  referenceRevision?: string;
  pageWidthMm: number;
  pageHeightMm: number;
  orientation: LabelPageOrientation;
  labelWidthMm: number;
  labelHeightMm: number;
  contentPreset: LabelContentPreset;
  safeInsetMm: number;
  defaultOffsetXMm: number;
  defaultOffsetYMm: number;
  supportsCuttingGuides: boolean;
  defaultCuttingGuides: boolean;
  supportsPartialSheet: boolean;
  verificationStatus: LabelGeometryVerificationStatus;
  verificationNote: string;
  gridSpec?: GridLayoutSpec;
  explicitGrid?: ExplicitGridSpec;
  explicitSlots?: readonly LabelSlotPosition[];
}

export interface ResolvedLabelTemplate extends LabelTemplateDefinition {
  columns: number;
  rows: number;
  slotsPerPage: number;
  slots: readonly LabelSlotPosition[];
}

export interface LabelPageAllocation<T> {
  pageNumber: number;
  startSlot: number;
  slots: Array<{
    slot: LabelSlotPosition;
    item: T;
  }>;
}

export const CALIBRATION_OFFSET_LIMIT_MM = 25;

/**
 * Compute deterministic centered grid slots for standard paper formats.
 * Never stretches or shrinks individual label dimensions.
 */
export function computeStandardGridSlots(
  pageWidthMm: number,
  pageHeightMm: number,
  labelWidthMm: number,
  labelHeightMm: number,
  grid: GridLayoutSpec,
): { columns: number; rows: number; slots: LabelSlotPosition[] } {
  const usableWidth = pageWidthMm - 2 * grid.minMarginXMm;
  const usableHeight = pageHeightMm - 2 * grid.minMarginYMm;

  const columns = Math.floor((usableWidth + grid.gapXMm) / (labelWidthMm + grid.gapXMm));
  const rows = Math.floor((usableHeight + grid.gapYMm) / (labelHeightMm + grid.gapYMm));

  if (columns < 1 || rows < 1) {
    throw new Error(
      `Invalid grid geometry: label ${labelWidthMm}x${labelHeightMm} mm does not fit on ${pageWidthMm}x${pageHeightMm} mm page`,
    );
  }

  const totalGridWidth = columns * labelWidthMm + (columns - 1) * grid.gapXMm;
  const totalGridHeight = rows * labelHeightMm + (rows - 1) * grid.gapYMm;
  const marginLeftMm = (pageWidthMm - totalGridWidth) / 2;
  const marginTopMm = (pageHeightMm - totalGridHeight) / 2;

  const slots: LabelSlotPosition[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const index = row * columns + col;
      slots.push({
        index,
        row,
        col,
        xMm: Number((marginLeftMm + col * (labelWidthMm + grid.gapXMm)).toFixed(3)),
        yTopMm: Number((marginTopMm + row * (labelHeightMm + grid.gapYMm)).toFixed(3)),
        widthMm: labelWidthMm,
        heightMm: labelHeightMm,
      });
    }
  }

  return { columns, rows, slots };
}

export function resolveLabelTemplate(def: LabelTemplateDefinition): ResolvedLabelTemplate {
  let columns: number;
  let rows: number;
  let slots: LabelSlotPosition[];

  if (def.explicitSlots && def.explicitSlots.length > 0) {
    slots = [...def.explicitSlots].sort((a, b) => a.index - b.index);
    columns = Math.max(...slots.map((s) => s.col)) + 1;
    rows = Math.max(...slots.map((s) => s.row)) + 1;
  } else if (def.explicitGrid) {
    columns = def.explicitGrid.colXMm.length;
    rows = def.explicitGrid.rowYTopMm.length;
    slots = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        slots.push({
          index: row * columns + col,
          row,
          col,
          xMm: def.explicitGrid.colXMm[col]!,
          yTopMm: def.explicitGrid.rowYTopMm[row]!,
          widthMm: def.labelWidthMm,
          heightMm: def.labelHeightMm,
        });
      }
    }
  } else if (def.gridSpec) {
    const computed = computeStandardGridSlots(
      def.pageWidthMm,
      def.pageHeightMm,
      def.labelWidthMm,
      def.labelHeightMm,
      def.gridSpec,
    );
    columns = computed.columns;
    rows = computed.rows;
    slots = computed.slots;
  } else {
    throw new Error(`Template '${def.id}' must define explicitSlots, explicitGrid, or gridSpec`);
  }

  const resolved: ResolvedLabelTemplate = {
    ...def,
    columns,
    rows,
    slotsPerPage: slots.length,
    slots,
  };

  validateTemplateGeometry(resolved);
  return resolved;
}

export function validateTemplateGeometry(template: ResolvedLabelTemplate): void {
  if (template.pageWidthMm <= 0 || template.pageHeightMm <= 0) {
    throw new Error(`Template '${template.id}' has non-positive page dimensions`);
  }
  if (template.labelWidthMm <= 0 || template.labelHeightMm <= 0) {
    throw new Error(`Template '${template.id}' has non-positive label dimensions`);
  }
  if (template.safeInsetMm < 0 || template.safeInsetMm * 2 >= Math.min(template.labelWidthMm, template.labelHeightMm)) {
    throw new Error(`Template '${template.id}' has invalid safeInsetMm`);
  }
  if (template.slots.length === 0) {
    throw new Error(`Template '${template.id}' has no slots`);
  }

  for (let i = 0; i < template.slots.length; i++) {
    const s = template.slots[i]!;
    if (s.widthMm <= 0 || s.heightMm <= 0) {
      throw new Error(`Template '${template.id}' slot ${s.index} has non-positive size`);
    }
    if (
      s.xMm < 0 ||
      s.yTopMm < 0 ||
      s.xMm + s.widthMm > template.pageWidthMm + 0.01 ||
      s.yTopMm + s.heightMm > template.pageHeightMm + 0.01
    ) {
      throw new Error(
        `Template '${template.id}' slot ${s.index} (${s.xMm}, ${s.yTopMm}, ${s.widthMm}x${s.heightMm}) exceeds page bounds (${template.pageWidthMm}x${template.pageHeightMm})`,
      );
    }

    for (let j = i + 1; j < template.slots.length; j++) {
      const o = template.slots[j]!;
      const overlapX = s.xMm < o.xMm + o.widthMm - 0.01 && s.xMm + s.widthMm > o.xMm + 0.01;
      const overlapY = s.yTopMm < o.yTopMm + o.heightMm - 0.01 && s.yTopMm + s.heightMm > o.yTopMm + 0.01;
      if (overlapX && overlapY) {
        throw new Error(`Template '${template.id}' slots ${s.index} and ${o.index} overlap`);
      }
    }
  }
}

export function validateCalibrationOffsets(
  template: ResolvedLabelTemplate,
  offsetXMm: number,
  offsetYMm: number,
): void {
  if (!Number.isFinite(offsetXMm) || !Number.isFinite(offsetYMm)) {
    throw new Error("Calibration offsets must be finite numbers");
  }
  if (
    Math.abs(offsetXMm) > CALIBRATION_OFFSET_LIMIT_MM ||
    Math.abs(offsetYMm) > CALIBRATION_OFFSET_LIMIT_MM
  ) {
    throw new Error(
      `Calibration offsets must be between -${CALIBRATION_OFFSET_LIMIT_MM} mm and +${CALIBRATION_OFFSET_LIMIT_MM} mm`,
    );
  }
  // Note: offsetXMm shifts right (+X), offsetYMm shifts up in PDF (+Y), so yTop shifts by -offsetYMm.
  for (const s of template.slots) {
    const shiftedX = s.xMm + offsetXMm;
    const shiftedYTop = s.yTopMm - offsetYMm;
    if (
      shiftedX < -0.01 ||
      shiftedYTop < -0.01 ||
      shiftedX + s.widthMm > template.pageWidthMm + 0.01 ||
      shiftedYTop + s.heightMm > template.pageHeightMm + 0.01
    ) {
      throw new Error(
        `Calibration offset (${offsetXMm}, ${offsetYMm}) mm pushes slot #${s.index + 1} outside page bounds`,
      );
    }
  }
}

export function paginateLabelItems<T>(
  template: ResolvedLabelTemplate,
  items: readonly T[],
  startingIndex: number,
): LabelPageAllocation<T>[] {
  const safeStart = Math.min(Math.max(Math.trunc(startingIndex), 0), template.slotsPerPage - 1);
  if (items.length === 0) {
    return [{ pageNumber: 1, startSlot: safeStart, slots: [] }];
  }

  const pages: LabelPageAllocation<T>[] = [];
  let itemIdx = 0;
  let pageNumber = 1;
  let slotCursor = safeStart;

  while (itemIdx < items.length) {
    const pageStartSlot = slotCursor;
    const pageSlots: Array<{ slot: LabelSlotPosition; item: T }> = [];

    while (slotCursor < template.slotsPerPage && itemIdx < items.length) {
      pageSlots.push({
        slot: template.slots[slotCursor]!,
        item: items[itemIdx]!,
      });
      slotCursor++;
      itemIdx++;
    }

    pages.push({
      pageNumber,
      startSlot: pageStartSlot,
      slots: pageSlots,
    });

    pageNumber++;
    slotCursor = 0;
  }

  return pages;
}

/**
 * Authoritative Label Template Registry.
 *
 * Adding a new template:
 * 1. Add a LabelTemplateDefinition entry to RAW_LABEL_TEMPLATES below.
 * 2. Geometry is validated automatically on module load via resolveLabelTemplate().
 * 3. Add geometry & PDF verification tests in apps/api/tests/inventory.test.ts.
 */
const RAW_LABEL_TEMPLATES: readonly LabelTemplateDefinition[] = [
  {
    id: "103",
    name: "Labelindo No. 103 (64 × 32 mm)",
    shortLabel: "Labelindo No. 103",
    description: "Lembar stiker pabrikan 12 label (3 × 4)",
    family: "manufacturer",
    manufacturer: "PT Label Indonesia",
    productNumber: "No. 103",
    referenceUrl: "https://www.labelindonesia.com/wp-content/uploads/2025/11/Labelindo-No.103.pdf",
    referenceRevision: "2025-11",
    pageWidthMm: 215.138,
    pageHeightMm: 296.926,
    orientation: "portrait",
    labelWidthMm: 64.0,
    labelHeightMm: 32.0,
    contentPreset: "standard",
    safeInsetMm: 2.0,
    defaultOffsetXMm: 0,
    defaultOffsetYMm: 0,
    supportsCuttingGuides: false,
    defaultCuttingGuides: false,
    supportsPartialSheet: true,
    verificationStatus: "verified_pdf_provisional_physical",
    verificationNote:
      "Geometri PDF terverifikasi dari template resmi Labelindo No. 103 (215,14 × 296,93 mm). Batas potong fisik stiker bersifat provisional hingga uji cetak pada printer target.",
    explicitGrid: {
      colXMm: [5.84, 75.05, 144.25],
      rowYTopMm: [14.14, 48.78, 86.80, 124.82],
    },
  },
  {
    id: "107",
    name: "Labelindo No. 107 (50 × 18 mm)",
    shortLabel: "Labelindo No. 107",
    description: "Lembar stiker pabrikan kompak 30 label (3 × 10)",
    family: "manufacturer",
    manufacturer: "PT Label Indonesia",
    productNumber: "No. 107",
    referenceUrl: "https://www.labelindonesia.com/wp-content/uploads/2025/11/Labelindo-No.107.pdf",
    referenceRevision: "2025-11",
    pageWidthMm: 296.926,
    pageHeightMm: 254.0,
    orientation: "landscape",
    labelWidthMm: 50.0,
    labelHeightMm: 18.0,
    contentPreset: "compact",
    safeInsetMm: 1.4,
    defaultOffsetXMm: 0,
    defaultOffsetYMm: 0,
    supportsCuttingGuides: false,
    defaultCuttingGuides: false,
    supportsPartialSheet: true,
    verificationStatus: "verified_pdf_provisional_physical",
    verificationNote:
      "Geometri PDF terverifikasi dari template resmi Labelindo No. 107 (296,93 × 254,00 mm Lanskap). Batas potong fisik stiker bersifat provisional hingga uji cetak pada printer target.",
    explicitGrid: {
      colXMm: [10.84, 64.96, 119.16],
      rowYTopMm: [50.82, 70.64, 90.46, 110.28, 130.10, 149.92, 169.74, 189.56, 209.38, 229.20],
    },
  },
  {
    id: "a4-standard",
    name: "A4 Standar (64 × 32 mm)",
    shortLabel: "A4 Standar",
    description: "Kertas HVS / stiker utuh A4, 24 label (3 × 8)",
    family: "standard_paper",
    pageWidthMm: 210.0,
    pageHeightMm: 297.0,
    orientation: "portrait",
    labelWidthMm: 64.0,
    labelHeightMm: 32.0,
    contentPreset: "standard",
    safeInsetMm: 2.0,
    defaultOffsetXMm: 0,
    defaultOffsetYMm: 0,
    supportsCuttingGuides: true,
    defaultCuttingGuides: true,
    supportsPartialSheet: true,
    verificationStatus: "verified_standard_paper",
    verificationNote:
      "Standar ISO A4 (210 × 297 mm) ukuran aktual 100%. Mendukung garis bantu potong manual.",
    gridSpec: {
      minMarginXMm: 6.0,
      minMarginYMm: 8.0,
      gapXMm: 3.0,
      gapYMm: 3.0,
    },
  },
  {
    id: "a4-compact",
    name: "A4 Kompak (50 × 18 mm)",
    shortLabel: "A4 Kompak",
    description: "Kertas HVS / stiker utuh A4, 39 label (3 × 13)",
    family: "standard_paper",
    pageWidthMm: 210.0,
    pageHeightMm: 297.0,
    orientation: "portrait",
    labelWidthMm: 50.0,
    labelHeightMm: 18.0,
    contentPreset: "compact",
    safeInsetMm: 1.4,
    defaultOffsetXMm: 0,
    defaultOffsetYMm: 0,
    supportsCuttingGuides: true,
    defaultCuttingGuides: true,
    supportsPartialSheet: true,
    verificationStatus: "verified_standard_paper",
    verificationNote:
      "Standar ISO A4 (210 × 297 mm) ukuran aktual 100%. Mendukung garis bantu potong manual.",
    gridSpec: {
      minMarginXMm: 6.0,
      minMarginYMm: 8.0,
      gapXMm: 3.0,
      gapYMm: 2.5,
    },
  },
];

export const LABEL_TEMPLATE_REGISTRY: ReadonlyMap<string, ResolvedLabelTemplate> = new Map(
  RAW_LABEL_TEMPLATES.map((raw) => {
    const resolved = resolveLabelTemplate(raw);
    return [resolved.id, resolved] as const;
  }),
);

export const DEFAULT_LABEL_TEMPLATE_ID = "103";

export function getRegisteredLabelTemplates(): ResolvedLabelTemplate[] {
  return Array.from(LABEL_TEMPLATE_REGISTRY.values());
}

export function getLabelTemplate(templateId: string): ResolvedLabelTemplate | undefined {
  return LABEL_TEMPLATE_REGISTRY.get(templateId);
}
