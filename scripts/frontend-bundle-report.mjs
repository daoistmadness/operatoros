import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDirectory = join(repositoryRoot, "apps/web/build");
const manifestPath = join(buildDirectory, ".vite/manifest.json");

export const ROUTE_CHUNK_BUDGET = {
  rawBytes: 160_000,
  gzipBytes: 40_000,
};

function importedKeys(manifest, rootKey) {
  const visited = new Set();

  function visit(key) {
    if (visited.has(key) || !manifest[key]) return;
    visited.add(key);
    for (const importedKey of manifest[key].imports ?? []) visit(importedKey);
  }

  visit(rootKey);
  return visited;
}

function fileSizes(file, readAsset) {
  const contents = readAsset(file);
  return {
    rawBytes: contents.byteLength,
    gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
  };
}

function sumSizes(files) {
  return [...files.values()].reduce((total, size) => ({
    rawBytes: total.rawBytes + size.rawBytes,
    gzipBytes: total.gzipBytes + size.gzipBytes,
  }), { rawBytes: 0, gzipBytes: 0 });
}

export function createBundleReport(manifest, readAsset) {
  const javascriptFiles = new Map();
  for (const chunk of Object.values(manifest)) {
    if (chunk.file.endsWith(".js") && !javascriptFiles.has(chunk.file)) {
      javascriptFiles.set(chunk.file, fileSizes(chunk.file, readAsset));
    }
  }

  const routeEntries = Object.entries(manifest)
    .filter(([key, chunk]) => key.startsWith("src/pages/") && chunk.isDynamicEntry && chunk.file.endsWith(".js"))
    .map(([key, chunk]) => {
      const entrySize = javascriptFiles.get(chunk.file);
      if (!entrySize) throw new Error(`Missing route entry asset: ${chunk.file}`);

      const closureFiles = new Map();
      for (const importedKey of importedKeys(manifest, key)) {
        const importedChunk = manifest[importedKey];
        if (!importedChunk.file.endsWith(".js")) continue;
        const size = javascriptFiles.get(importedChunk.file);
        if (!size) throw new Error(`Missing route import asset: ${importedChunk.file}`);
        closureFiles.set(importedChunk.file, size);
      }

      return {
        source: key,
        file: chunk.file,
        ...entrySize,
        staticClosure: sumSizes(closureFiles),
      };
    })
    .sort((left, right) => right.gzipBytes - left.gzipBytes || left.source.localeCompare(right.source));

  if (routeEntries.length === 0) throw new Error("Vite manifest contains no dynamic page entries under src/pages/.");

  return {
    totalJavaScript: sumSizes(javascriptFiles),
    javascriptFileCount: javascriptFiles.size,
    routeEntries,
  };
}

export function findRouteBudgetViolations(routeEntries, budget = ROUTE_CHUNK_BUDGET) {
  return routeEntries.filter((entry) => entry.rawBytes > budget.rawBytes || entry.gzipBytes > budget.gzipBytes);
}

function readManifest() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${manifestPath}. Run the web production build first.`, { cause: error });
  }

  return createBundleReport(manifest, (file) => readFileSync(join(buildDirectory, file)));
}

function run() {
  const report = readManifest();
  if (process.argv.includes("--check")) {
    console.log(`JavaScript: ${report.javascriptFileCount} files, ${report.totalJavaScript.rawBytes} raw bytes, ${report.totalJavaScript.gzipBytes} gzip bytes`);
    console.log(`Route entries: ${report.routeEntries.length}; budget: ${ROUTE_CHUNK_BUDGET.rawBytes} raw / ${ROUTE_CHUNK_BUDGET.gzipBytes} gzip bytes each`);
    console.table(report.routeEntries.slice(0, 5).map(({ source, rawBytes, gzipBytes }) => ({ source, rawBytes, gzipBytes })));
    const violations = findRouteBudgetViolations(report.routeEntries);
    if (violations.length) {
      console.error(JSON.stringify(violations, null, 2));
      throw new Error(`Route chunk budget exceeded: ${violations.map(({ source }) => source).join(", ")}`);
    }
    console.log("Route chunk budgets passed.");
    return;
  }

  console.log(JSON.stringify({ budget: ROUTE_CHUNK_BUDGET, ...report }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
