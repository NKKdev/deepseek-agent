import type sharp from "sharp";
type SharpModule = typeof sharp;
export declare const MAX_IMAGE_BYTES: number;
export declare const MAX_IMAGE_PIXELS = 64000000;
export declare const MAX_IMAGE_DIMENSION = 8192;
export declare const NORMALIZED_IMAGE_MAX_DIMENSION = 2048;
export declare const NORMALIZED_IMAGE_MAX_BYTES: number;
export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
export type NormalizedImage = {
    data: Buffer;
    mediaType: Exclude<ImageMediaType, "image/gif">;
    width: number;
    height: number;
    originalDimensions?: {
        width: number;
        height: number;
    };
};
export declare function normalizeImage(data: Buffer, declaredMediaType: ImageMediaType, sharp: SharpModule): Promise<NormalizedImage>;
export {};
//# sourceMappingURL=image-normalizer.d.ts.map