const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function requireFrom(packageJson) {
  return createRequire(realpathSync(path.join(root, packageJson)));
}

async function main() {
  const webRequire = requireFrom('apps/web/node_modules/openapi-typescript/package.json');
  const { readFileFromUrl } = webRequire('@redocly/openapi-core/lib/utils');
  let receivedHeaders;
  const response = await readFileFromUrl('https://example.test/spec/v1.json', {
    headers: [{
      name: 'X-OperatorOS-Test',
      value: 'matched',
      matches: 'https://example.test/spec/*.json',
    }],
    customFetch: async (_url, options) => {
      receivedHeaders = options.headers;
      return {
        ok: true,
        text: async () => '{"openapi":"3.1.0"}',
        headers: { get: () => 'application/json' },
      };
    },
  });
  assert.deepEqual(receivedHeaders, { 'X-OperatorOS-Test': 'matched' });
  assert.equal(response.body, '{"openapi":"3.1.0"}');

  const excelRequire = requireFrom('packages/excel/node_modules/exceljs/package.json');
  const ExcelJS = excelRequire('exceljs');
  const archiverPath = excelRequire.resolve('archiver');
  const archiverRequire = createRequire(realpathSync(archiverPath));
  const archiverUtilsPaths = [
    archiverRequire.resolve('archiver-utils'),
    createRequire(realpathSync(archiverRequire.resolve('zip-stream'))).resolve('archiver-utils'),
  ];
  const readdirGlob = archiverRequire('readdir-glob');

  const fixture = mkdtempSync(path.join(os.tmpdir(), 'operatoros-minimatch-'));
  try {
    mkdirSync(path.join(fixture, 'nested'));
    writeFileSync(path.join(fixture, 'root.json'), '{}');
    writeFileSync(path.join(fixture, 'nested', 'child.json'), '{}');
    writeFileSync(path.join(fixture, 'nested', 'notes.txt'), 'synthetic');
    writeFileSync(path.join(fixture, '.hidden.json'), '{}');

    for (const archiverUtilsPath of archiverUtilsPaths) {
      const utilsRequire = createRequire(realpathSync(archiverUtilsPath));
      const { file } = utilsRequire(archiverUtilsPath);
      const glob = utilsRequire('glob');
      assert.deepEqual(
        file.expand({ cwd: fixture }, '**/*.json').sort(),
        ['nested/child.json', 'root.json'],
      );
      assert.deepEqual(
        file.expand({ cwd: fixture, dot: true }, '**/*.json').sort(),
        ['.hidden.json', 'nested/child.json', 'root.json'],
      );
      assert.deepEqual(
        file.expand({ cwd: fixture }, '**/*.@(json|txt)').sort(),
        ['nested/child.json', 'nested/notes.txt', 'root.json'],
      );
      assert.deepEqual(
        file.expand({ cwd: fixture }, ['**/*.json', '!nested/**']).sort(),
        ['root.json'],
      );

      const asyncMatches = await new Promise((resolve, reject) => {
        glob('**/*.json', { cwd: fixture }, (error, matches) =>
          error ? reject(error) : resolve(matches),
        );
      });
      assert.deepEqual(asyncMatches.sort(), ['nested/child.json', 'root.json']);
    }

    const entries = await new Promise((resolve, reject) => {
      readdirGlob(fixture, {
        pattern: '**/*.json',
        ignore: 'nested/**',
        nodir: true,
      }, (error, matches) => error ? reject(error) : resolve(matches));
    });
    assert.deepEqual(entries, ['root.json']);

    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Synthetic').addRow(['value']).commit();
    const ordinaryXlsx = await workbook.xlsx.writeBuffer();
    const ordinaryReadback = new ExcelJS.Workbook();
    await ordinaryReadback.xlsx.load(ordinaryXlsx);
    assert.equal(ordinaryReadback.getWorksheet('Synthetic').getCell('A1').value, 'value');

    const output = new (require('node:stream').PassThrough)();
    const chunks = [];
    output.on('data', (chunk) => chunks.push(chunk));
    const finished = new Promise((resolve, reject) => {
      output.once('finish', resolve);
      output.once('error', reject);
    });
    const streamingWorkbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output });
    const streamingSheet = streamingWorkbook.addWorksheet('Streaming');
    streamingSheet.addRow(['stream-value']).commit();
    await streamingWorkbook.commit();
    await finished;
    const streamedXlsx = Buffer.concat(chunks);

    const streamingReader = new ExcelJS.stream.xlsx.WorkbookReader(
      require('node:stream').Readable.from([streamedXlsx]),
      { sharedStrings: 'cache', worksheets: 'emit' },
    );
    const readRows = [];
    for await (const worksheet of streamingReader) {
      for await (const row of worksheet) {
        readRows.push(row.values);
      }
    }
    assert.deepEqual(readRows, [[, 'stream-value']]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }

  console.log('minimatch override compatibility passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
