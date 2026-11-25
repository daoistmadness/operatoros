import { PDFDocument, StandardFonts, rgb, grayscale } from "pdf-lib";
import type { LabelTemplateIdDto } from "@operatoros/contracts/inventory";

const MM_TO_PT = 72 / 25.4; // 2.834645669291339

export interface LabelAssetItem {
  id: string;
  asset_code: string;
  item_name: string;
  school_unit_name: string;
  category: string;
  brand?: string | null;
  location?: string | null;
  funding_source: string;
  budget_year: number;
  condition: string;
}

export interface LabelTemplateConfig {
  id: LabelTemplateIdDto;
  name: string;
  sheetWidthPt: number;
  sheetHeightPt: number;
  columns: number;
  rows: number;
  labelWidthPt: number;
  labelHeightPt: number;
  marginLeftPt: number;
  marginTopPt: number;
  gapXPt: number;
  gapYPt: number;
}

export const LABEL_TEMPLATES: Record<LabelTemplateIdDto, LabelTemplateConfig> = {
  "103": {
    id: "103",
    name: "Labelindo / Tom & Jerry No. 103 (64 x 32 mm, 12 label/lembar)",
    sheetWidthPt: 215.14 * MM_TO_PT,
    sheetHeightPt: 296.93 * MM_TO_PT,
    columns: 3,
    rows: 4,
    labelWidthPt: 64.0 * MM_TO_PT,
    labelHeightPt: 32.0 * MM_TO_PT,
    marginLeftPt: ((215.14 - (3 * 64.0 + 2 * 4.5)) / 2) * MM_TO_PT,
    marginTopPt: 10.0 * MM_TO_PT,
    gapXPt: 4.5 * MM_TO_PT,
    gapYPt: 2.5 * MM_TO_PT,
  },
  "107": {
    id: "107",
    name: "Labelindo / Tom & Jerry No. 107 (50 x 18 mm, 30 label/lembar)",
    sheetWidthPt: 215.0 * MM_TO_PT,
    sheetHeightPt: 297.0 * MM_TO_PT,
    columns: 3,
    rows: 10,
    labelWidthPt: 50.0 * MM_TO_PT,
    labelHeightPt: 18.0 * MM_TO_PT,
    marginLeftPt: ((215.0 - (3 * 50.0 + 2 * 4.0)) / 2) * MM_TO_PT,
    marginTopPt: 11.0 * MM_TO_PT,
    gapXPt: 4.0 * MM_TO_PT,
    gapYPt: 1.5 * MM_TO_PT,
  },
};

export interface LabelPdfOptions {
  templateId: LabelTemplateIdDto;
  startingIndex?: number;
  offsetXmm?: number;
  offsetYmm?: number;
  monochrome?: boolean;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

export async function generateAssetLabelsPdf(
  assets: LabelAssetItem[],
  options: LabelPdfOptions,
): Promise<Uint8Array> {
  const template = LABEL_TEMPLATES[options.templateId] ?? LABEL_TEMPLATES["103"];
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const isMono = options.monochrome ?? false;
  const colorPrimary = isMono ? rgb(0, 0, 0) : rgb(0.12, 0.23, 0.54);       // Navy
  const colorDark = isMono ? rgb(0, 0, 0) : rgb(0.06, 0.09, 0.16);          // Charcoal black
  const colorMuted = isMono ? rgb(0.25, 0.25, 0.25) : rgb(0.35, 0.40, 0.48); // Slate muted
  const colorBorder = isMono ? rgb(0.70, 0.70, 0.70) : rgb(0.80, 0.83, 0.88);// Border
  const colorLine = isMono ? rgb(0.85, 0.85, 0.85) : rgb(0.90, 0.92, 0.95);

  const offsetXPt = (options.offsetXmm ?? 0) * MM_TO_PT;
  const offsetYPt = (options.offsetYmm ?? 0) * MM_TO_PT;
  const slotsPerPage = template.columns * template.rows;
  const startingIndex = Math.min(Math.max(options.startingIndex ?? 0, 0), slotsPerPage - 1);

  let currentPage = pdfDoc.addPage([template.sheetWidthPt, template.sheetHeightPt]);
  let currentSlot = startingIndex;

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]!;

    if (currentSlot >= slotsPerPage) {
      currentPage = pdfDoc.addPage([template.sheetWidthPt, template.sheetHeightPt]);
      currentSlot = 0;
    }

    const col = currentSlot % template.columns;
    const row = Math.floor(currentSlot / template.columns);

    const x = template.marginLeftPt + col * (template.labelWidthPt + template.gapXPt) + offsetXPt;
    // PDF (0, 0) is bottom-left, so top-down calculation:
    const y = template.sheetHeightPt - template.marginTopPt - template.labelHeightPt - row * (template.labelHeightPt + template.gapYPt) + offsetYPt;

    // Draw sticker boundary guide
    currentPage.drawRectangle({
      x,
      y,
      width: template.labelWidthPt,
      height: template.labelHeightPt,
      borderColor: colorBorder,
      borderWidth: 0.5,
    });

    if (template.id === "103") {
      // No. 103: 64 x 32 mm
      // Top School Header
      const headerText = `${truncate(asset.school_unit_name.toUpperCase(), 24)} • INVENTARIS`;
      currentPage.drawText(headerText, {
        x: x + 6,
        y: y + template.labelHeightPt - 11,
        size: 7,
        font: fontBold,
        color: colorPrimary,
      });

      // Divider line
      currentPage.drawLine({
        start: { x: x + 6, y: y + template.labelHeightPt - 14 },
        end: { x: x + template.labelWidthPt - 6, y: y + template.labelHeightPt - 14 },
        thickness: 0.5,
        color: colorLine,
      });

      // Prominent Asset Code
      currentPage.drawText(asset.asset_code, {
        x: x + 6,
        y: y + template.labelHeightPt - 28,
        size: 13,
        font: fontBold,
        color: colorPrimary,
      });

      // Asset Item Name
      currentPage.drawText(truncate(asset.item_name, 28), {
        x: x + 6,
        y: y + template.labelHeightPt - 43,
        size: 8.5,
        font: fontBold,
        color: colorDark,
      });

      // Brand / Location spec
      const specItems = [asset.brand, asset.location].filter(Boolean) as string[];
      if (specItems.length > 0) {
        currentPage.drawText(truncate(specItems.join(" • "), 34), {
          x: x + 6,
          y: y + template.labelHeightPt - 56,
          size: 7,
          font: fontRegular,
          color: colorMuted,
        });
      }

      // Funding & Year Footer
      const footerText = `Sumber: ${asset.funding_source} (${asset.budget_year})`;
      currentPage.drawText(footerText, {
        x: x + 6,
        y: y + 9,
        size: 7,
        font: fontRegular,
        color: colorMuted,
      });
    } else {
      // No. 107: 50 x 18 mm (Compact)
      // Top Unit Header
      const headerText = `${truncate(asset.school_unit_name.toUpperCase(), 16)} INVENTARIS`;
      currentPage.drawText(headerText, {
        x: x + 4,
        y: y + template.labelHeightPt - 8,
        size: 5.5,
        font: fontBold,
        color: colorPrimary,
      });

      // Asset Code
      currentPage.drawText(asset.asset_code, {
        x: x + 4,
        y: y + template.labelHeightPt - 18,
        size: 9.5,
        font: fontBold,
        color: colorPrimary,
      });

      // Item Name
      currentPage.drawText(truncate(asset.item_name, 24), {
        x: x + 4,
        y: y + template.labelHeightPt - 28,
        size: 6.5,
        font: fontRegular,
        color: colorDark,
      });

      // Meta Footer
      const meta = `${asset.funding_source} ${asset.budget_year}${asset.location ? ` • ${truncate(asset.location, 12)}` : ""}`;
      currentPage.drawText(meta, {
        x: x + 4,
        y: y + 5,
        size: 5.5,
        font: fontRegular,
        color: colorMuted,
      });
    }

    currentSlot++;
  }

  return await pdfDoc.save();
}
