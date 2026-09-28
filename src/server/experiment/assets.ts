import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import mammoth from "mammoth";
import { unzipSync } from "fflate";
import type { StudyAsset, StudyAttachment } from "../../shared/experiment.js";

export const ASSET_ROOT = path.resolve("data/assets");
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function checkedId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new Error("Invalid resource ID");
  return id;
}
export async function extractDocument(name: string, bytes: Buffer) {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("Files must be between 1 byte and 10 MB");
  const extension = path.extname(name).toLowerCase();
  let mime = "text/plain"; let extractedText = ""; const warnings: string[] = [];
  if (extension === ".docx") {
    let size = 0;
    unzipSync(bytes, { filter: entry => { size += entry.originalSize; if (size > 40 * 1024 * 1024) throw new Error("DOCX expanded content exceeds 40 MB"); return false; } });
    const result = await mammoth.extractRawText({ buffer: bytes });
    extractedText = result.value; mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    warnings.push("Text extraction does not preserve layout, tables, comments, or images reliably. Review against the original before use.", ...result.messages.map(m => m.message));
  } else if (extension === ".pdf") {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const document = await loading.promise;
    try {
      if (document.numPages > 100) throw new Error("PDF limit is 100 pages");
      for (let i = 1; i <= document.numPages; i++) {
        const content = await (await document.getPage(i)).getTextContent();
        extractedText += content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("") + "\n\n";
        if (extractedText.length > 200000) throw new Error("Extracted text exceeds 200,000 characters");
      }
    } finally { await loading.destroy(); }
    mime = "application/pdf"; warnings.push("PDF reading order may differ from the visible page. Images and scanned text are not extracted; OCR is not applied.");
  } else if ([".txt", ".md", ".csv", ".json"].includes(extension)) {
    extractedText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } else if (extension === ".png" && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    mime = "image/png";
  } else if ([".jpg", ".jpeg"].includes(extension) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    mime = "image/jpeg";
  } else throw new Error("Supported uploads: DOCX, text PDF, UTF-8 TXT/MD/CSV/JSON, PNG, and JPEG");
  if (extractedText.length > 200000) throw new Error("Extracted text exceeds 200,000 characters");
  if (!extractedText.trim() && !mime.startsWith("image/")) warnings.push("No readable text was found. Enter and review the content manually before using this as a stimulus.");
  return { mime, extractedText, warnings };
}
export async function saveAsset(name: string, bytes: Buffer, root = ASSET_ROOT): Promise<StudyAsset> {
  name = path.basename(name.replaceAll("\\", "/")).replace(/[\x00-\x1f]/g, "").slice(0, 180);
  if (!name) throw new Error("A file name is required");
  const content = await extractDocument(name, bytes);
  const asset: StudyAsset = { id: randomUUID(), name, bytes: bytes.length, sha256: sha256(bytes), ...content };
  const dir = path.join(root, asset.id); await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "original"), bytes, { flag: "wx" });
  await writeFile(path.join(dir, "metadata.json"), JSON.stringify(asset, null, 2), { flag: "wx" });
  return asset;
}
export async function readAsset(id: string, root = ASSET_ROOT) {
  const dir = path.join(root, checkedId(id));
  const asset = JSON.parse(await readFile(path.join(dir, "metadata.json"), "utf8")) as StudyAsset;
  const bytes = await readFile(path.join(dir, "original"));
  if (sha256(bytes) !== asset.sha256) throw new Error("Attachment integrity check failed");
  return { asset, bytes };
}
export async function canonicalAttachments(bindings: StudyAttachment[] = [], root = ASSET_ROOT) {
  return Promise.all(bindings.map(async binding => {
    const { asset } = await readAsset(binding.id, root);
    if (asset.sha256 !== binding.sha256) throw new Error("The attachment changed; review it again");
    return { ...binding, ...asset };
  }));
}
