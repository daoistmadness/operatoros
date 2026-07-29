# Ingestion dependency strategy

## Decision

`NO_CHANGE_JUSTIFIED`. Current ingestion uses pandas and openpyxl; no synthetic
benchmark or output-parity comparison currently demonstrates a safe benefit
from replacement. Calamine is not justified without a measured bottleneck and
native-packaging assessment.

Future evaluation uses deterministic synthetic generators (about 100, 5,000,
and 50,000 rows plus malformed, duplicate, mixed-date, formula, blank-row, and
header cases) and disposable databases. Measure cold import, workbook open,
validation, transformation, write, total duration, peak RSS, accepted/rejected
records, conflicts, and output parity.

A benchmark-only streaming `openpyxl.load_workbook(..., read_only=True,
data_only=True)` adapter may be evaluated, but production behavior changes only
after parity for validation, normalization, duplicates, conflicts, writes, and
history. A follow-up needs at least a 20% memory or duration improvement (or a
material desktop-size/startup improvement) with no business regression.
