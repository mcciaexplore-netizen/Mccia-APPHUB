/** pdf.js's worker module, loaded into the page itself for the PDF import (see convert.ts); the package ships no types for it. */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
