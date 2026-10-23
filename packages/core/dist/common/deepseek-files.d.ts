export declare const DEEPSEEK_FILES_BASE_URL = "https://api.deepseek.com";
export declare const MAX_DEEPSEEK_FILE_BYTES: number;
export type DeepSeekFilesPolicy = {
    timeoutMs: number;
    expiresAfterSeconds: number;
    refreshMarginSeconds: number;
    quotaCleanupBatch: number;
};
export type DeepSeekImage = {
    buffer: Buffer;
    mediaType: "image/jpeg" | "image/png" | "image/webp";
    extension: "jpg" | "png" | "webp";
    hash: string;
};
export type DeepSeekFileReference = {
    fileId: string;
    imageHash: string;
    bytes: number;
};
type RemoteFile = {
    id: string;
    bytes: number;
    filename: string;
    createdAt: number;
    expiresAt?: number;
};
export declare class DeepSeekFilesApiError extends Error {
    readonly status: number;
    readonly detail: string;
    constructor(message: string, status: number, detail: string);
}
export declare function validateDeepSeekFileSize(bytes: number, index?: number): void;
export declare function decodeDeepSeekImageDataUrl(dataUrl: string, index?: number): DeepSeekImage;
export declare class DeepSeekFilesClient {
    private readonly apiKey;
    private readonly fetchImpl;
    constructor(apiKey: string, fetchImpl?: typeof fetch);
    private request;
    upload(image: DeepSeekImage, expiresAfterSeconds: number, signal?: AbortSignal): Promise<RemoteFile>;
    list(after: string | undefined, signal?: AbortSignal): Promise<{
        files: RemoteFile[];
        lastId?: string;
        hasMore: boolean;
    }>;
    delete(fileId: string, signal?: AbortSignal): Promise<void>;
}
export declare class DeepSeekFileStore {
    private readonly cachePath;
    private readonly fetchImpl;
    private readonly now;
    private readonly inflight;
    constructor(cachePath?: string, fetchImpl?: typeof fetch, now?: () => number);
    private scope;
    private load;
    private isCachedFile;
    private save;
    ensureUploaded(image: DeepSeekImage, apiKey: string, policy: DeepSeekFilesPolicy, signal?: AbortSignal): Promise<DeepSeekFileReference>;
    private upload;
    private cleanupOldestOwned;
    invalidate(reference: DeepSeekFileReference, apiKey: string): void;
}
export {};
//# sourceMappingURL=deepseek-files.d.ts.map