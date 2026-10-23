import type { FileState, FileLineEnding } from "./state";
export type FileReadMetadata = {
    content: string;
    encoding: BufferEncoding;
    lineEndings: FileLineEnding;
    timestamp: number;
};
export declare function normalizeContent(value: string): string;
export declare function detectLineEndings(value: string): FileLineEnding;
export declare function platformLineEnding(eol?: string): FileLineEnding;
/** Resolve Git's eol attribute for a new file, falling back to the platform default. */
export declare function newFileLineEnding(filePath: string, eol?: string): FileLineEnding;
export declare function detectEncoding(buffer: Buffer): BufferEncoding;
export declare function readTextFileWithMetadata(filePath: string): FileReadMetadata;
export declare function writeTextFile(filePath: string, content: string, encoding: BufferEncoding, lineEndings: FileLineEnding): number;
export declare function ensureParentDirectory(filePath: string): void;
export declare function hasFileChangedSinceState(filePath: string, state: FileState): boolean;
export declare function buildDiffPreview(filePath: string, originalContent: string | null, updatedContent: string, maxLines?: number): string | null;
//# sourceMappingURL=file-utils.d.ts.map