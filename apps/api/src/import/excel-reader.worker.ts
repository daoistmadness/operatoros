import { parseAttendanceWorkbook, type WorkbookRows } from "./excel-reader";

type ParserWorkerRequest = { id: number; buffer: ArrayBuffer; filename: string };
type ParserWorkerResponse =
  | { id: number; workbook: WorkbookRows }
  | { id: number; errorName: string; errorMessage: string };

declare const self: {
  onmessage: ((event: MessageEvent<ParserWorkerRequest>) => void) | null;
  postMessage(message: ParserWorkerResponse): void;
};

self.onmessage = ({ data }) => {
  void parseAttendanceWorkbook(data.buffer, data.filename).then(
    (workbook) => self.postMessage({ id: data.id, workbook } satisfies ParserWorkerResponse),
    (error: unknown) => {
      self.postMessage({
        id: data.id,
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : "The server could not preview the workbook.",
      } satisfies ParserWorkerResponse);
    },
  );
};
