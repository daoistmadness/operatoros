export const TERM_METADATA = {
  1: { months: [7, 9], shortLabel: 'Jul–Sep', longLabel: 'July–September' },
  2: { months: [10, 12], shortLabel: 'Oct–Dec', longLabel: 'October–December' },
  3: { months: [1, 3], shortLabel: 'Jan–Mar', longLabel: 'January–March' },
  4: { months: [4, 6], shortLabel: 'Apr–Jun', longLabel: 'April–June' },
}

export const TERM_OPTIONS = Object.entries(TERM_METADATA).map(([value, metadata]) => ({
  value: Number(value),
  label: `Term ${value} (${metadata.shortLabel})`,
}))

export function getAcademicYearLabel(anchorYear, anchorMonth) {
  const startYear = anchorMonth >= 7 ? anchorYear : anchorYear - 1
  return `TA ${startYear}/${startYear + 1}`
}

export function getTermAcademicYearLabel(term, year) {
  const termMetadata = TERM_METADATA[term]
  const anchorMonth = termMetadata?.months?.[0] ?? 1
  return getAcademicYearLabel(year, anchorMonth)
}
