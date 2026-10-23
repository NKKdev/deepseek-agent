// Core library public API — used by both CLI and VSCode companion.
// Settings
export { resolveCurrentSettings, resolveSettings, resolveSettingsSources, readSettings, readProjectSettings, writeSettings, writeProjectSettings, writeModelConfigSelection, applyModelConfigSelection, modelConfigKey, getUserSettingsPath, getProjectSettingsPath, readDeepcodePlusApiKey, readDeepcodePlusSettings, getDefaultContextWindow, getDefaultAutoCompactWindow, DEFAULT_MODEL, DEFAULT_BASE_URL, DEFAULT_FILES_API_TIMEOUT_MS, DEFAULT_FILE_EXPIRES_AFTER_SECONDS, DEFAULT_FILE_REFRESH_MARGIN_SECONDS, DEFAULT_FILE_QUOTA_CLEANUP_BATCH, DEFAULT_MAX_REQUEST_FILES_BYTES, MAX_FILES_API_TIMEOUT_MS, } from "./settings.js";
// Session
export { SessionManager, getProjectCode, getCompactPromptTokenThreshold } from "./session.js";
// Prompt utilities
export { getSystemPrompt, getCompactPrompt, getRuntimeContext, getPlanModePrompt, getExtensionRoot, getTools, buildSkillDocumentsPrompt, } from "./prompt.js";
// Tools
export { ToolExecutor } from "./tools/executor.js";
// Tool handlers
export { handleBashTool, clearSessionWorkingDir } from "./tools/bash-handler.js";
export { handleReadTool } from "./tools/read-handler.js";
export { handleReadImageTool } from "./tools/read-image-handler.js";
export { handleWriteTool } from "./tools/write-handler.js";
export { handleEditTool } from "./tools/edit-handler.js";
export { handleUpdatePlanTool } from "./tools/update-plan-handler.js";
export { handleUnderstandImageTool } from "./tools/understand-image-handler.js";
export { handleWebSearchTool } from "./tools/web-search-handler.js";
export { handleAskUserQuestionTool } from "./tools/ask-user-question-handler.js";
// MCP
export { McpManager } from "./mcp/mcp-manager.js";
export { McpClient } from "./mcp/mcp-client.js";
// Common utilities
export { createOpenAIClient, createOpenAIClientFactory, resolveOpenAIConnection, DEEPCODE_PLUS_BASE_URL, } from "./common/openai-client.js";
export { buildThinkingRequestOptions } from "./common/openai-thinking.js";
export { readTextFileWithMetadata, writeTextFile, buildDiffPreview, ensureParentDirectory } from "./common/file-utils.js";
export { normalizeFilePath, getSnippet, clearSessionState, recordFileState, getFileState } from "./common/state.js";
export { GitFileHistory } from "./common/file-history.js";
export { killProcessTree } from "./common/process-tree.js";
export { TENCENT_MIRROR_REGISTRY } from "./common/npm-registry.js";
export { launchNotifyScript } from "./common/notify.js";
export { reportNewPrompt } from "./common/telemetry.js";
export { DEEPSEEK_V4_MODELS, supportsMultimodal, defaultsToThinkingMode } from "./common/model-capabilities.js";
export { findGitBashPath, resolveShellPath, setShellIfWindows } from "./common/shell-utils.js";
export { logApiError } from "./common/error-logger.js";
export { logOpenAIChatCompletionDebug } from "./common/debug-logger.js";
export { describeLlmError, getLlmErrorDetails } from "./common/llm-error.js";
export { clampBashTimeoutMs, DEFAULT_BASH_TIMEOUT_MS, BASH_TIMEOUT_INCREMENT_MS, BASH_TIMEOUT_DECREMENT_MS, } from "./common/bash-timeout.js";
export { executeValidatedTool, semanticBoolean } from "./common/validate.js";
export { OpenAIMessageConverter } from "./common/openai-message-converter.js";
export { computeToolCallPermissions, buildPermissionToolExecution, hasUserPermissionReplies, appendProjectPermissionAllows, normalizeAskPermissions, parseToolCallForPermissions, } from "./common/permissions.js";
export { checkPlusSubscription, withPlusSubscription } from "./common/plus-subscription.js";
