import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { type CreateOpenAIClient, type PluginRateLimitedTool, type SharpLoader, type ToolExecutionResult } from "./tools/executor";
import { type McpServerConfig, type PermissionScope, type PermissionSettings } from "./settings";
import { type AskPermissionRequest, type MessageToolPermission, type UserToolPermission } from "./common/permissions";
import { type MultimodalMode } from "./common/model-capabilities";
export type { PermissionScope } from "./settings";
export type { AskPermissionRequest, AskPermissionScope, BashPermissionScope, MessageToolPermission, PermissionDecision, UserToolPermission, } from "./common/permissions";
export declare function getCompactPromptTokenThreshold(model: string): number;
export declare function getProjectCode(projectRoot: string): string;
export type SessionStatus = "failed" | "pending" | "processing" | "waiting_for_user" | "completed" | "interrupted" | "ask_permission" | "permission_denied";
export type ModelUsage = {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: Record<string, unknown>;
    prompt_tokens_details?: Record<string, unknown>;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    total_reqs?: number;
};
export type SessionProcessEntry = {
    startTime: string;
    command: string;
    timeoutMs?: number;
    deadlineAt?: string;
    timedOut?: boolean;
};
export type BashTimeoutAdjustment = {
    processId: string;
    timeoutMs: number;
    deadlineAt: string;
    timedOut: boolean;
};
export type SessionEntry = {
    id: string;
    summary: string | null;
    assistantReply: string | null;
    assistantThinking: string | null;
    assistantRefusal: string | null;
    toolCalls: unknown[] | null;
    status: SessionStatus;
    failReason: string | null;
    usage: ModelUsage | null;
    usagePerModel: Record<string, ModelUsage> | null;
    activeTokens: number;
    createTime: string;
    updateTime: string;
    processes: Map<string, SessionProcessEntry> | null;
    askPermissions?: AskPermissionRequest[];
    planMode?: boolean;
    pluginRateLimitedTool?: PluginRateLimitedTool;
    usingPlus?: boolean;
    forkedFrom?: {
        sessionId: string;
        messageId: string;
    };
};
export type SessionsIndex = {
    version: 1;
    entries: SessionEntry[];
    originalPath: string;
};
export type SessionMessageRole = "system" | "user" | "assistant" | "tool";
export type MessageMeta = {
    function?: unknown;
    paramsMd?: string;
    resultMd?: string;
    asThinking?: boolean;
    isAnswers?: boolean;
    isSummary?: boolean;
    isModelChange?: boolean;
    skill?: SkillInfo;
    skillCatalog?: Array<{
        name: string;
        description: string;
    }>;
    permissions?: MessageToolPermission[];
    userPrompt?: UserPromptContent;
};
export type SessionMessage = {
    id: string;
    sessionId: string;
    role: SessionMessageRole;
    content: string | null;
    contentParams: unknown | null;
    messageParams: unknown | null;
    compacted: boolean;
    visible: boolean;
    createTime: string;
    updateTime: string;
    meta?: MessageMeta;
    html?: string;
    checkpointHash?: string;
};
export type UndoTarget = {
    message: SessionMessage;
    index: number;
    canRestoreCode: boolean;
};
export type UserPromptContent = {
    text?: string;
    imageUrls?: string[];
    skills?: SkillInfo[];
    permissions?: UserToolPermission[];
    alwaysAllows?: PermissionScope[];
    planMode?: boolean;
    isAnswers?: boolean;
};
export type SkillInfo = {
    name: string;
    path: string;
    description: string;
    isLoaded?: boolean;
    allowImplicitInvocation?: boolean;
};
export type SessionManagerOptions = {
    projectRoot: string;
    createOpenAIClient: CreateOpenAIClient;
    getResolvedSettings: () => {
        model: string;
        multimodal?: MultimodalMode;
        filesApiEnabled?: boolean;
        filesApiTimeoutMs?: number;
        fileExpiresAfterSeconds?: number;
        fileRefreshMarginSeconds?: number;
        fileQuotaCleanupBatch?: number;
        maxRequestFilesBytes?: number;
        contextWindow?: number;
        autoCompactWindow?: number;
        webSearchTool?: string;
        mcpServers?: Record<string, McpServerConfig>;
        permissions?: Required<PermissionSettings>;
        enabledSkills?: Record<string, boolean>;
    };
    renderMarkdown: (text: string) => string;
    onAssistantMessage: (message: SessionMessage, shouldConnect: boolean) => void;
    onSessionEntryUpdated?: (entry: SessionEntry) => void;
    onLlmStreamProgress?: (progress: LlmStreamProgress) => void;
    onLlmRetry?: (event: LlmRetryEvent) => void;
    onMcpStatusChanged?: () => void;
    onProcessStdout?: (pid: number, chunk: string) => void;
    loadSharp?: SharpLoader;
    nonInteractive?: boolean;
    getSharedSessionMessages?: (sessionId: string) => SessionMessage[] | undefined;
    getCompactSessionIds?: (sessionId: string) => string[] | undefined;
    onManageSubagent?: (sessionId: string, args: Record<string, unknown>) => Promise<{
        ok: boolean;
        output?: string;
        error?: string;
    }>;
};
export type LlmStreamProgress = {
    requestId: string;
    sessionId?: string;
    startedAt: string;
    estimatedTokens: number;
    formattedTokens: string;
    previewText?: string;
    phase: "start" | "update" | "end";
};
export type LlmRetryEvent = {
    requestId: string;
    sessionId?: string;
    error: string;
    attempt: number;
    maxRetries: number;
    delayMs: number;
};
export declare class SessionManager {
    private readonly projectRoot;
    private readonly createOpenAIClient;
    private readonly getResolvedSettings;
    private readonly onAssistantMessage;
    private readonly onSessionEntryUpdated?;
    private readonly onLlmStreamProgress?;
    private readonly onLlmRetry?;
    private readonly onMcpStatusChanged?;
    private readonly onProcessStdout?;
    private readonly nonInteractive;
    private activeSessionId;
    private activePromptController;
    private readonly sessionControllers;
    private readonly processTimeoutControls;
    private readonly liveProcessKeys;
    private readonly toolExecutor;
    private readonly loadSharp?;
    private readonly mcpManager;
    private mcpToolDefinitions;
    private readonly messageConverter;
    private readonly deepSeekFiles;
    constructor(options: SessionManagerOptions);
    /**
     * @deprecated Use messageConverter.buildMessages directly.
     * Kept for test compatibility.
     */
    buildOpenAIMessages(messages: SessionMessage[], thinkingEnabled: boolean, model: string, multimodal?: MultimodalMode): ChatCompletionMessageParam[];
    initMcpServers(servers?: Record<string, McpServerConfig>): Promise<void>;
    getMcpStatus(): import(".").McpServerStatus[];
    reconnectMcpServer(name: string, config?: McpServerConfig): Promise<void>;
    dispose(): void;
    private estimateStreamTokens;
    private formatEstimatedTokens;
    private formatStreamPreview;
    private emitLlmStreamProgress;
    private isAbortLikeError;
    private throwIfAborted;
    private getDeepSeekFilesSettings;
    private buildMessagesWithDeepSeekFiles;
    private isRejectedDeepSeekFile;
    private createChatCompletionStream;
    private createChatCompletionStreamAttempt;
    private logChatCompletionDebug;
    private recordResponseUsage;
    identifyMatchingSkillNames(skills: SkillInfo[], userPrompt: string, options?: {
        signal?: AbortSignal;
        sessionId?: string;
    }): Promise<string[]>;
    private getSkillScanRoots;
    private getBundledSkillsRoot;
    listSkills(sessionId?: string): Promise<SkillInfo[]>;
    private resolveSkillPath;
    private buildSkillPrompt;
    private readSkillInfo;
    private getSkillKey;
    private getSkillKeyByName;
    private getLoadedSkillKeys;
    private dedupeSkills;
    private normalizeSkills;
    private appendSkillMessages;
    private listPreloadedSkillCatalog;
    private mergeSkillCatalog;
    private appendSkillCatalogMessage;
    loadSkillByName(sessionId: string, skillName: string): Promise<ToolExecutionResult>;
    getActiveSessionId(): string | null;
    setActiveSessionId(sessionId: string | null): void;
    addSessionSystemMessage(sessionId: string, content: string, visible?: boolean, meta?: MessageMeta): void;
    handleUserPrompt(userPrompt: UserPromptContent): Promise<void>;
    createSession(userPrompt: UserPromptContent, controller?: AbortController): Promise<string>;
    replySession(sessionId: string, userPrompt: UserPromptContent, controller?: AbortController): Promise<void>;
    private isContinuePrompt;
    activateSession(sessionId: string, controller?: AbortController, permissionPrompt?: UserPromptContent): Promise<void>;
    compactSession(sessionId: string, signal?: AbortSignal): Promise<void>;
    private getPromptToolOptions;
    private prepareSessionMessagesForRequest;
    private attachPromptImagesForRequest;
    private getLocalPromptImagePath;
    private reportNewPrompt;
    interruptActiveSession(): void;
    interruptSession(sessionId: string): void;
    private isInterrupted;
    /**
     * Mark a session's permission as denied by the user.
     * Updates the session entry status and failReason so the denial is visible in the session list.
     */
    denySessionPermission(sessionId: string, reason?: string): void;
    adjustActiveBashTimeout(deltaMs: number): BashTimeoutAdjustment | null;
    listSessions(): SessionEntry[];
    getSession(sessionId: string): SessionEntry | null;
    forkSession(sourceSessionId: string, options?: {
        dropTrailingToolCall?: boolean;
    }): string;
    /**
     * Delete a session by its ID.
     * Removes the session entry from the index and cleans up associated resources
     * such as message files, in-memory state caches, working directory state,
     * session controllers, and tracked process timeout controls.
     * Returns true if the session was found and deleted, false otherwise.
     */
    deleteSession(sessionId: string): boolean;
    /**
     * Rename a session by updating its summary (display title).
     * Returns true if the session was found and renamed, false otherwise.
     */
    renameSession(sessionId: string, summary: string): boolean;
    listSessionMessages(sessionId: string): SessionMessage[];
    listUndoTargets(sessionId: string): UndoTarget[];
    restoreSessionConversation(sessionId: string, messageId: string): SessionMessage[];
    restoreSessionCode(sessionId: string, messageId: string): void;
    restoreFileBeforeEdits(sessionId: string, filePath: string): void;
    private normalizeSessionMessage;
    private getProjectStorage;
    private getFileHistory;
    private getFileHistoryGitDir;
    private ensureFileHistorySession;
    private getCurrentCheckpointHash;
    private recordUserPromptCheckpoint;
    private prepareFileMutationCheckpoint;
    private recordFileMutationCheckpoint;
    private updateLatestUserCheckpointHash;
    private canRestoreCheckpointHash;
    private restoreCheckpointHash;
    private isUndoTargetMessage;
    private ensureProjectDir;
    private loadSessionsIndex;
    private saveSessionsIndex;
    private getSessionMessagesPath;
    private getSessionImagesDir;
    private getReadPermissionExemptPaths;
    private removeSessionMessages;
    private cleanupSessionResources;
    private appendSessionMessage;
    private saveSessionMessages;
    private updateSessionEntry;
    private buildUserMessage;
    private preparePromptImages;
    private decodePersistedPromptImage;
    private copySessionImagesForFork;
    private appendPlanModeTransitionMessages;
    private renderInitCommandPrompt;
    private getEffectiveProjectAgentsMdFile;
    private loadProjectAgentInstructions;
    private readNonEmptyFile;
    private loadAgentInstructions;
    private buildSystemMessage;
    private buildFollowUpMessage;
    private buildSkillMessage;
    private buildAssistantMessage;
    private generateToolCallId;
    private normalizeLlmToolCalls;
    private buildToolMessage;
    private getToolResultSkill;
    private loadSkillForToolBatch;
    private appendToolMessages;
    private cloneUserPromptForMeta;
    private hasTrailingPendingToolCalls;
    private appendDeferredPermissionPrompt;
    private buildToolParamsSnippet;
    private formatToolParamsSnippet;
    private buildToolResultSnippet;
    private formatToolResultSnippet;
    private isInvisibleExecution;
    private maybeNotifyTaskCompletion;
    private addSessionProcess;
    private addBackgroundProcessCompletionMessage;
    private buildBackgroundFailureLogTailSlice;
    private readTextFileTail;
    private formatBackgroundDuration;
    private recordPluginRateLimitExceeded;
    private removeSessionProcess;
    private setSessionProcessTimeoutControl;
    private updateSessionProcessTimeout;
    private buildBashTimeoutAdjustment;
    private getProcessControlKey;
    private killLiveProcesses;
    private killTrackedProcess;
    private getProcessIdFromControlKey;
    private getProcessIds;
    private normalizeSessionEntry;
    private normalizePluginRateLimitedTool;
    private normalizeForkedFrom;
    private normalizeSessionStatus;
    private normalizeUsagePerModel;
    private deserializeProcesses;
    private serializeProcesses;
}
//# sourceMappingURL=session.d.ts.map