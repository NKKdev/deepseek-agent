import { type MultimodalMode } from "./common/model-capabilities";
export type DeepcodingEnv = Record<string, string | undefined> & {
    MODEL?: string;
    BASE_URL?: string;
    API_KEY?: string;
    TEMPERATURE?: string;
    THINKING_ENABLED?: string;
    REASONING_EFFORT?: string;
    DEBUG_LOG_ENABLED?: string;
    TELEMETRY_ENABLED?: string;
    MULTIMODAL?: string;
};
export type ReasoningEffort = "low" | "high" | "max";
export type McpServerConfig = {
    command: string;
    args?: string[];
    env?: Record<string, string>;
};
export type PermissionScope = "read-in-cwd" | "read-in-tmp" | "read-out-cwd" | "write-in-cwd" | "write-in-tmp" | "write-out-cwd" | "delete-in-cwd" | "delete-out-cwd" | "query-git-log" | "mutate-git-log" | "network" | "mcp";
export type PermissionDefaultMode = "allowAll" | "askAll";
export type PermissionSettings = {
    allow?: PermissionScope[];
    deny?: PermissionScope[];
    ask?: PermissionScope[];
    defaultMode?: PermissionDefaultMode;
    addWorkingDirs?: string[];
};
export type EnabledSkillsSettings = Record<string, boolean>;
export type StatusLineProviderConfig = {
    type: "command";
    id?: string;
    command: string;
    cwd?: string;
    timeoutMs?: number;
    color?: string;
    newLine?: boolean;
    maxLength?: number;
} | {
    type: "module";
    id?: string;
    path: string;
    timeoutMs?: number;
    color?: string;
    newLine?: boolean;
    maxLength?: number;
};
export type StatusLineSettings = {
    enabled?: boolean;
    refreshMs?: number;
    separator?: string;
    providers?: StatusLineProviderConfig[];
};
export type ResolvedStatusLineSettings = {
    enabled: boolean;
    refreshMs: number;
    separator: string;
    providers: StatusLineProviderConfig[];
};
export type DeepcodingSettings = {
    env?: DeepcodingEnv;
    contextWindow?: number | string;
    autoCompactWindow?: number | string;
    model?: string;
    temperature?: number;
    thinkingEnabled?: boolean;
    reasoningEffort?: ReasoningEffort;
    debugLogEnabled?: boolean;
    telemetryEnabled?: boolean;
    notify?: string;
    webSearchTool?: string;
    multimodal?: MultimodalMode;
    filesApiEnabled?: boolean;
    filesApiTimeoutMs?: number;
    fileExpiresAfterSeconds?: number;
    fileRefreshMarginSeconds?: number;
    fileQuotaCleanupBatch?: number;
    maxRequestFilesBytes?: number;
    mcpServers?: Record<string, McpServerConfig>;
    permissions?: PermissionSettings;
    enabledSkills?: EnabledSkillsSettings;
    statusline?: StatusLineSettings;
};
export type ResolvedDeepcodingSettings = {
    env: Record<string, string>;
    apiKey?: string;
    baseURL: string;
    model: string;
    contextWindow: number;
    autoCompactWindow: number;
    temperature?: number;
    thinkingEnabled: boolean;
    reasoningEffort: ReasoningEffort;
    debugLogEnabled: boolean;
    telemetryEnabled: boolean;
    notify?: string;
    webSearchTool?: string;
    multimodal: MultimodalMode;
    filesApiEnabled: boolean;
    filesApiTimeoutMs: number;
    fileExpiresAfterSeconds: number;
    fileRefreshMarginSeconds: number;
    fileQuotaCleanupBatch: number;
    maxRequestFilesBytes: number;
    mcpServers?: Record<string, McpServerConfig>;
    permissions: Required<PermissionSettings>;
    enabledSkills: EnabledSkillsSettings;
    statusline: ResolvedStatusLineSettings;
};
export type ModelConfigSelection = {
    model: string;
    thinkingEnabled: boolean;
    reasoningEffort: ReasoningEffort;
};
export type SettingsProcessEnv = Record<string, string | undefined>;
export declare const DEFAULT_FILES_API_TIMEOUT_MS = 60000;
export declare const DEFAULT_FILE_EXPIRES_AFTER_SECONDS: number;
export declare const DEFAULT_FILE_REFRESH_MARGIN_SECONDS: number;
export declare const DEFAULT_FILE_QUOTA_CLEANUP_BATCH = 100;
export declare const DEFAULT_MAX_REQUEST_FILES_BYTES: number;
export declare const MAX_FILES_API_TIMEOUT_MS: number;
export declare function getDefaultContextWindow(model: string): number;
export declare function getDefaultAutoCompactWindow(model: string): number;
export declare function collectDeepcodeEnv(processEnv?: SettingsProcessEnv): Record<string, string>;
export declare function resolveSettingsSources(userSettings: DeepcodingSettings | null | undefined, projectSettings: DeepcodingSettings | null | undefined, defaults: {
    model: string;
    baseURL: string;
}, processEnv?: SettingsProcessEnv): ResolvedDeepcodingSettings;
export declare function resolveSettings(settings: DeepcodingSettings | null | undefined, defaults: {
    model: string;
    baseURL: string;
}, processEnv?: SettingsProcessEnv): ResolvedDeepcodingSettings;
export declare function modelConfigKey(config: Pick<ModelConfigSelection, "thinkingEnabled" | "reasoningEffort">): string;
export declare function applyModelConfigSelection(settings: DeepcodingSettings | null | undefined, current: ModelConfigSelection, selected: ModelConfigSelection): {
    settings: DeepcodingSettings;
    changed: boolean;
};
export declare const DEFAULT_MODEL = "deepseek-flash";
export declare const DEFAULT_BASE_URL = "https://api.deepseek.com";
export { getDeepcodePlusSettingsPath, readDeepcodePlusSettings, readDeepcodePlusApiKey, type SubscriptionPlan, type DeepcodePlusSettings, } from "./common/plus-subscription";
export declare function getUserSettingsPath(): string;
export declare function getProjectSettingsPath(projectRoot: string): string;
export declare function readSettingsFile(settingsPath: string): DeepcodingSettings | null;
export declare function readSettings(): DeepcodingSettings | null;
export declare function readProjectSettings(projectRoot?: string): DeepcodingSettings | null;
export declare function writeSettings(settings: DeepcodingSettings): void;
export declare function writeProjectSettings(settings: DeepcodingSettings, projectRoot?: string): void;
export declare function writeModelConfigSelection(selection: ModelConfigSelection, current?: ModelConfigSelection, projectRoot?: string): {
    changed: boolean;
    settings: DeepcodingSettings;
};
export declare function resolveCurrentSettings(projectRoot?: string): ResolvedDeepcodingSettings;
//# sourceMappingURL=settings.d.ts.map