const MAX_LOCAL_PDF_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 2_000_000;

/** Extract selectable text from a PDF in the browser without uploading the file. */
export async function extractPdfText(file: File): Promise<string> {
  if (file.size > MAX_LOCAL_PDF_BYTES) {
    throw new Error("This PDF is larger than the 50 MB local extraction limit. Configure a document-conversion endpoint for larger files.");
  }

  const [pdfjs, workerModule] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  let extractedLength = 0;

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        pageText += item.str;
        pageText += "hasEOL" in item && item.hasEOL ? "\n" : " ";
      }
      const normalized = pageText
        .replace(/[ \t]+\n/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (normalized) {
        pages.push(normalized);
        extractedLength += normalized.length;
      }
      page.cleanup();
      if (extractedLength >= MAX_EXTRACTED_CHARS) break;
    }
  } finally {
    await document.destroy();
  }

  const text = pages.join("\n\n").slice(0, MAX_EXTRACTED_CHARS).trim();
  if (!text) {
    throw new Error("No selectable text was found in this PDF. It may be scanned or image-only; use an OCR-capable document-conversion endpoint.");
  }
  return text;
}
