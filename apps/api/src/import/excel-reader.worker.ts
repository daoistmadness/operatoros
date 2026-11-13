import { parentPort } from "node:worker_threads";
import { parseAttendanceWorkbook, type WorkbookRows } from "./excel-reader";

type ParserWorkerRequest = { id: number; buffer: ArrayBuffer; filename: string };
type ParserWorkerResponse =
  | { id: number; workbook: WorkbookRows }
  | { id: number; errorName: string; errorMessage: string };

declare const self: {
  onmessage: ((event: MessageEvent<ParserWorkerRequest>) => void) | null;
  postMessage(message: ParserWorkerResponse): void;
};

function handleMessage(data: ParserWorkerRequest): void {
  const postMessage = (message: ParserWorkerResponse) => {
    if (parentPort) parentPort.postMessage(message);
    else self.postMessage(message);
  };
  void parseAttendanceWorkbook(data.buffer, data.filename).then(
    (workbook) => postMessage({ id: data.id, workbook } satisfies ParserWorkerResponse),
    (error: unknown) => {
      postMessage({
        id: data.id,
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : "The server could not preview the workbook.",
      } satisfies ParserWorkerResponse);
    },
  );
}

if (parentPort) parentPort.on("message", handleMessage);
else self.onmessage = ({ data }) => handleMessage(data);
