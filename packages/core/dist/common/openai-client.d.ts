import OpenAI from "openai";
import { type ReasoningEffort } from "../settings";
import { type OpenAIConnectionContext } from "./plus-subscription";
import type { CreateOpenAIClient } from "./tool-types";
export { resolveOpenAIConnection, DEEPCODE_PLUS_BASE_URL } from "./plus-subscription";
export declare function createOpenAIClientFactory(projectRoot?: string): CreateOpenAIClient;
export declare function createOpenAIClient(projectRoot?: string, context?: OpenAIConnectionContext): {
    client: OpenAI | null;
    apiKey?: string;
    model: string;
    baseURL: string;
    temperature?: number;
    thinkingEnabled: boolean;
    reasoningEffort: ReasoningEffort;
    debugLogEnabled: boolean;
    telemetryEnabled: boolean;
    notify?: string;
    webSearchTool?: string;
    env: Record<string, string>;
    machineId?: string;
    plusApiKey?: string;
    usingPlus: boolean;
    configurationError?: string;
};
//# sourceMappingURL=openai-client.d.ts.map