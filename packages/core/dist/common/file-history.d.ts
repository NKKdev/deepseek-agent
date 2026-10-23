export type FileHistoryCheckpointResult = {
    checkpointHash: string | undefined;
    changedFilePaths: string[];
};
export declare class GitFileHistory {
    private readonly gitDir;
    constructor(_projectRoot: string, gitDir: string);
    ensureSession(sessionId: string): string | undefined;
    getCurrentCheckpointHash(sessionId: string): string | undefined;
    forkSession(sourceSessionId: string, targetSessionId: string): string | undefined;
    recordCheckpoint(sessionId: string, filePaths: string[], message: string): string | undefined;
    recordTrackedFilesCheckpoint(sessionId: string, message: string): FileHistoryCheckpointResult;
    canRestore(sessionId: string, checkpointHash: string): boolean;
    restore(sessionId: string, checkpointHash: string): void;
    restoreFileBeforeEdits(sessionId: string, filePath: string): void;
    private restoreFirstKnownEntry;
    private findFirstKnownEntry;
    private getSessionBranchRef;
    private createCommit;
    private createTree;
    private readManifest;
    private readBlob;
    private hashFile;
    private hashContent;
    private getFileKey;
    private runGit;
    private runGitBuffer;
    private spawnGit;
}
//# sourceMappingURL=file-history.d.ts.map