import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  getLabelTemplate,
  paginateLabelItems,
  validateCalibrationOffsets,
  type LabelSlotPosition,
  type ResolvedLabelTemplate,
} from "@operatoros/contracts/inventory";

export const MM_TO_PT = 72 / 25.4; // 2.834645669291339

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

export interface LabelPdfOptions {
  templateId: string;
  templateOverride?: ResolvedLabelTemplate;
  startingIndex?: number;
  offsetXmm?: number;
  offsetYmm?: number;
  monochrome?: boolean;
  cuttingGuides?: boolean;
}

export interface CalibrationPdfOptions {
  templateId: string;
  templateOverride?: ResolvedLabelTemplate;
  offsetXmm?: number;
  offsetYmm?: number;
  monochrome?: boolean;
  cuttingGuides?: boolean;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

function resolveTemplateOrThrow(templateId: string, override?: ResolvedLabelTemplate): ResolvedLabelTemplate {
  const template = override ?? getLabelTemplate(templateId);
  if (!template) {
    throw new Error(`Unknown label template: '${templateId}'`);
  }
  return template;
}

function drawCuttingGuidesForSlot(
  page: any,
  xPt: number,
  yPt: number,
  wPt: number,
  hPt: number,
  color: ReturnType<typeof rgb>,
) {
  const tickLen = 3.5; // ~1.2 mm corner crop ticks
  const corners = [
    // Bottom-left
    { sx: xPt - tickLen, sy: yPt, ex: xPt, ey: yPt },
    { sx: xPt, sy: yPt - tickLen, ex: xPt, ey: yPt },
    // Bottom-right
    { sx: xPt + wPt, sy: yPt, ex: xPt + wPt + tickLen, ey: yPt },
    { sx: xPt + wPt, sy: yPt - tickLen, ex: xPt + wPt, ey: yPt },
    // Top-left
    { sx: xPt - tickLen, sy: yPt + hPt, ex: xPt, ey: yPt + hPt },
    { sx: xPt, sy: yPt + hPt, ex: xPt, ey: yPt + hPt + tickLen },
    // Top-right
    { sx: xPt + wPt, sy: yPt + hPt, ex: xPt + wPt + tickLen, ey: yPt + hPt },
    { sx: xPt + wPt, sy: yPt + hPt, ex: xPt + wPt, ey: yPt + hPt + tickLen },
  ];

  for (const c of corners) {
    page.drawLine({
      start: { x: c.sx, y: c.sy },
      end: { x: c.ex, y: c.ey },
      thickness: 0.4,
      color,
    });
  }
}

function toPdfRect(
  template: ResolvedLabelTemplate,
  slot: LabelSlotPosition,
  offsetXmm: number,
  offsetYmm: number,
) {
  return {
    x: (slot.xMm + offsetXmm) * MM_TO_PT,
    y: (template.pageHeightMm - slot.yTopMm - slot.heightMm + offsetYmm) * MM_TO_PT,
    w: slot.widthMm * MM_TO_PT,
    h: slot.heightMm * MM_TO_PT,
  };
}

export async function generateAssetLabelsPdf(
  assets: LabelAssetItem[],
  options: LabelPdfOptions,
): Promise<Uint8Array> {
  const template = resolveTemplateOrThrow(options.templateId, options.templateOverride);
  const offsetXmm = options.offsetXmm ?? template.defaultOffsetXMm;
  const offsetYmm = options.offsetYmm ?? template.defaultOffsetYMm;
  validateCalibrationOffsets(template, offsetXmm, offsetYmm);

  const startingIndex = options.startingIndex ?? 0;
  if (startingIndex < 0 || startingIndex >= template.slotsPerPage) {
    throw new Error(
      `Invalid starting_index ${startingIndex} for template '${template.id}' (valid range: 0..${template.slotsPerPage - 1})`,
    );
  }

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const isMono = options.monochrome ?? false;
  const showCuttingGuides = template.supportsCuttingGuides
    ? (options.cuttingGuides ?? template.defaultCuttingGuides)
    : false;

  const colorPrimary = isMono ? rgb(0, 0, 0) : rgb(0.12, 0.23, 0.54);       // Navy
  const colorAccent = isMono ? rgb(0.25, 0.25, 0.25) : rgb(0.75, 0.56, 0.08); // Gold
  const colorDark = isMono ? rgb(0, 0, 0) : rgb(0.06, 0.09, 0.16);          // Charcoal
  const colorMuted = isMono ? rgb(0.25, 0.25, 0.25) : rgb(0.35, 0.40, 0.48); // Slate
  const colorBorder = isMono ? rgb(0.72, 0.72, 0.72) : rgb(0.82, 0.85, 0.90);
  const colorGuide = isMono ? rgb(0.35, 0.35, 0.35) : rgb(0.55, 0.60, 0.68);

  const pageWidthPt = template.pageWidthMm * MM_TO_PT;
  const pageHeightPt = template.pageHeightMm * MM_TO_PT;
  const insetPt = template.safeInsetMm * MM_TO_PT;

  const pages = paginateLabelItems(template, assets, startingIndex);

  for (const pageAlloc of pages) {
    const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);

    for (const { slot, item: asset } of pageAlloc.slots) {
      const { x, y, w, h } = toPdfRect(template, slot, offsetXmm, offsetYmm);

      // Subtle slot border (or trim border when cutting guides enabled)
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        borderColor: showCuttingGuides ? colorGuide : colorBorder,
        borderWidth: showCuttingGuides ? 0.5 : 0.35,
      });

      if (showCuttingGuides) {
        drawCuttingGuidesForSlot(page, x, y, w, h, colorGuide);
      }

      const contentX = x + insetPt;
      const contentRightX = x + w - insetPt;

      if (template.contentPreset === "standard") {
        // Standard 64 x 32 mm layout
        const headerText = `${truncate(asset.school_unit_name.toUpperCase(), 20)} • INVENTARIS SEKOLAH`;
        page.drawText(headerText, {
          x: contentX,
          y: y + h - insetPt - 6,
          size: 6.5,
          font: fontBold,
          color: colorPrimary,
        });

        page.drawLine({
          start: { x: contentX, y: y + h - insetPt - 9.5 },
          end: { x: contentRightX, y: y + h - insetPt - 9.5 },
          thickness: 0.75,
          color: colorAccent,
        });

        // Permanent asset_code is never truncated
        page.drawText(asset.asset_code, {
          x: contentX,
          y: y + h - insetPt - 24,
          size: 13,
          font: fontBold,
          color: colorPrimary,
        });

        page.drawText(truncate(asset.item_name, 28), {
          x: contentX,
          y: y + h - insetPt - 38,
          size: 8.5,
          font: fontBold,
          color: colorDark,
        });

        const specItems = [asset.brand, asset.location].filter(Boolean) as string[];
        if (specItems.length > 0) {
          page.drawText(truncate(specItems.join(" • "), 34), {
            x: contentX,
            y: y + h - insetPt - 50,
            size: 7,
            font: fontRegular,
            color: colorMuted,
          });
        }

        const footerText = `Sumber: ${asset.funding_source} (${asset.budget_year})`;
        page.drawText(footerText, {
          x: contentX,
          y: y + insetPt + 2,
          size: 7,
          font: fontRegular,
          color: colorMuted,
        });
      } else {
        // Compact 50 x 18 mm layout
        const headerText = `${truncate(asset.school_unit_name.toUpperCase(), 16)} • INVENTARIS`;
        page.drawText(headerText, {
          x: contentX,
          y: y + h - insetPt - 4.5,
          size: 5.2,
          font: fontBold,
          color: colorPrimary,
        });

        // Permanent asset_code is never truncated
        page.drawText(asset.asset_code, {
          x: contentX,
          y: y + h - insetPt - 14.5,
          size: 9.5,
          font: fontBold,
          color: colorPrimary,
        });

        page.drawText(truncate(asset.item_name, 24), {
          x: contentX,
          y: y + h - insetPt - 23.5,
          size: 6.2,
          font: fontRegular,
          color: colorDark,
        });

        const meta = `${asset.funding_source} ${asset.budget_year}${asset.location ? ` • ${truncate(asset.location, 10)}` : ""}`;
        page.drawText(meta, {
          x: contentX,
          y: y + insetPt + 1,
          size: 5.2,
          font: fontRegular,
          color: colorMuted,
        });
      }
    }
  }

  return await pdfDoc.save();
}

export async function generateCalibrationPdf(options: CalibrationPdfOptions): Promise<Uint8Array> {
  const template = resolveTemplateOrThrow(options.templateId, options.templateOverride);
  const offsetXmm = options.offsetXmm ?? template.defaultOffsetXMm;
  const offsetYmm = options.offsetYmm ?? template.defaultOffsetYMm;
  validateCalibrationOffsets(template, offsetXmm, offsetYmm);

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidthPt = template.pageWidthMm * MM_TO_PT;
  const pageHeightPt = template.pageHeightMm * MM_TO_PT;
  const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);

  const isMono = options.monochrome ?? false;
  const colorMain = isMono ? rgb(0, 0, 0) : rgb(0.12, 0.23, 0.54);
  const colorTarget = isMono ? rgb(0, 0, 0) : rgb(0.80, 0.15, 0.15);
  const colorLight = rgb(0.65, 0.68, 0.72);

  const firstIndex = 0;
  const lastIndex = template.slots.length - 1;

  for (const slot of template.slots) {
    const { x, y, w, h } = toPdfRect(template, slot, offsetXmm, offsetYmm);
    const isTarget = slot.index === firstIndex || slot.index === lastIndex;

    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      borderColor: isTarget ? colorTarget : colorLight,
      borderWidth: isTarget ? 0.9 : 0.4,
    });

    if (template.supportsCuttingGuides && (options.cuttingGuides ?? template.defaultCuttingGuides)) {
      drawCuttingGuidesForSlot(page, x, y, w, h, colorLight);
    }

    if (isTarget) {
      // Crosshair at slot center
      const cx = x + w / 2;
      const cy = y + h / 2;
      page.drawLine({ start: { x: x + 2, y: cy }, end: { x: x + w - 2, y: cy }, thickness: 0.5, color: colorTarget });
      page.drawLine({ start: { x: cx, y: y + 2 }, end: { x: cx, y: y + h - 2 }, thickness: 0.5, color: colorTarget });
      page.drawText(`#${slot.index + 1} (${slot.xMm.toFixed(1)}, ${slot.yTopMm.toFixed(1)}mm)`, {
        x: x + 4,
        y: y + 4,
        size: 6,
        font: fontBold,
        color: colorTarget,
      });
    } else {
      page.drawText(`#${slot.index + 1}`, {
        x: x + 4,
        y: y + h - 10,
        size: 6,
        font: fontRegular,
        color: colorLight,
      });
    }
  }

  // Calibration header / scale bar placed safely near top-left or bottom depending on page space
  const infoY = template.pageHeightMm > 200 ? 10 : 6;
  page.drawText(
    `KALIBRASI: ${template.name} | Kertas ${template.pageWidthMm.toFixed(1)}x${template.pageHeightMm.toFixed(1)}mm (${template.orientation}) | Offset X=${offsetXmm}mm Y=${offsetYmm}mm (+X kanan, +Y atas) | CETAK SKALA 100% (MATIKAN FIT TO PAGE)`,
    {
      x: 12,
      y: infoY,
      size: 6.5,
      font: fontBold,
      color: colorMain,
    },
  );

  // 50 mm horizontal scale bar
  const barX = 12;
  const barY = infoY + 10;
  const barW = 50 * MM_TO_PT;
  page.drawLine({ start: { x: barX, y: barY }, end: { x: barX + barW, y: barY }, thickness: 1, color: colorMain });
  page.drawLine({ start: { x: barX, y: barY - 3 }, end: { x: barX, y: barY + 3 }, thickness: 1, color: colorMain });
  page.drawLine({ start: { x: barX + barW, y: barY - 3 }, end: { x: barX + barW, y: barY + 3 }, thickness: 1, color: colorMain });
  page.drawText("50 mm", { x: barX + barW + 4, y: barY - 2, size: 6.5, font: fontBold, color: colorMain });

  return await pdfDoc.save();
}
