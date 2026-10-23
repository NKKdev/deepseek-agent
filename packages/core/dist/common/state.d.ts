export type FileLineEnding = "LF" | "CRLF";
export type FileState = {
    filePath: string;
    content: string;
    timestamp: number;
    version?: number;
    offset?: number;
    limit?: number;
    isPartialView?: boolean;
    encoding?: BufferEncoding;
    lineEndings?: FileLineEnding;
};
export type FileSnippet = {
    id: string;
    filePath: string;
    startLine: number;
    endLine: number;
    preview: string;
    fileVersion: number;
    scopeType: "snippet" | "full";
};
export type SessionStateHistoryMessage = {
    role?: unknown;
    content?: unknown;
};
export declare function clearSessionState(sessionId: string): void;
export declare function hasSessionState(sessionId: string): boolean;
export declare function normalizeFilePath(filePath: string, platform?: NodeJS.Platform): string;
export declare function normalizeNativeFilePath(filePath: string, platform?: NodeJS.Platform): string;
export declare function isAbsoluteFilePath(filePath: string, platform?: NodeJS.Platform): boolean;
export declare function recordFileState(sessionId: string, state: FileState, options?: {
    incrementVersion?: boolean;
}): void;
export declare function markFileRead(sessionId: string, filePath: string, state?: Omit<FileState, "filePath"> | null): void;
export declare function getFileState(sessionId: string, filePath: string): FileState | null;
export declare function wasFileRead(sessionId: string, filePath: string): boolean;
export declare function getFileVersion(sessionId: string, filePath: string): number;
export declare function isFullFileView(state: FileState | null): boolean;
export declare function createSnippet(sessionId: string, filePath: string, startLine: number, endLine: number, preview: string): FileSnippet | null;
export declare function createFullFileSnippet(sessionId: string, filePath: string, startLine: number, endLine: number, preview: string): FileSnippet | null;
export declare function restoreSnippet(sessionId: string, snippet: {
    id: string;
    filePath: string;
    startLine: number;
    endLine: number;
    preview?: string;
    scopeType?: FileSnippet["scopeType"];
}): FileSnippet | null;
export declare function getSnippet(sessionId: string, snippetId: string): FileSnippet | null;
export declare function hasSnippetOutdatedFileVersion(sessionId: string, snippet: FileSnippet): boolean;
export declare function rebuildSessionStateFromHistory(sessionId: string, messages: Iterable<SessionStateHistoryMessage>): void;
//# sourceMappingURL=state.d.ts.map