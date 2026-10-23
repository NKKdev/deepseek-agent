import * as fs from "fs";
import * as path from "path";
import { MAX_IMAGE_BYTES, normalizeImage } from "./image-normalizer.js";
const MIME_TYPE_BY_EXTENSION = new Map([
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".webp", "image/webp"],
    [".gif", "image/gif"],
]);
export async function loadImageFile(filePath, loadSharp, signal) {
    signal?.throwIfAborted();
    const declaredMediaType = MIME_TYPE_BY_EXTENSION.get(path.extname(filePath).toLowerCase());
    if (!declaredMediaType) {
        throw new Error("Unsupported image format. Only PNG, JPEG, WebP, and GIF are supported.");
    }
    let stat;
    try {
        stat = fs.statSync(filePath);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to stat image: ${message}`, { cause: error });
    }
    if (!stat.isFile()) {
        throw new Error('"file_path" must point to a regular file.');
    }
    if (stat.size === 0) {
        throw new Error("Image file must not be empty.");
    }
    if (stat.size > MAX_IMAGE_BYTES) {
        throw new Error("Image file exceeds the 20 MiB source limit.");
    }
    const source = await fs.promises.readFile(filePath, { signal });
    signal?.throwIfAborted();
    const sharp = loadSharp ? await loadSharp() : (await import("sharp")).default;
    signal?.throwIfAborted();
    const image = await normalizeImage(source, declaredMediaType, sharp);
    signal?.throwIfAborted();
    return { image, stat };
}
