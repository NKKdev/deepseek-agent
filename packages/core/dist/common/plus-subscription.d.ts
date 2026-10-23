import type { CreateOpenAIClient, OpenAIClientResult } from "./tool-types";
export declare const DEEPCODE_PLUS_LEGACY_HOST = "https://deepcode.vegamo.cn";
export declare const DEEPCODE_PLUS_HOST = "https://www.deepcodeplus.com";
export declare const DEEPCODE_PLUS_LLM_HOST = "https://chat.deepcodeplus.com";
/** Undefined means unconfigured; all explicitly configured values must be valid. */
export declare function normalizePlusApiKey(value: unknown, settingsPath?: string): string | undefined;
export declare function resolvePlusHost(apiKey?: string): string;
export declare function resolvePlusLlmHost(apiKey?: string): string;
export declare function getDeepcodePlusSettingsPath(): string;
export type SubscriptionPlan = "default" | "on" | "off";
export type DeepcodePlusSettings = {
    apiKey?: string;
    subscriptionPlan: SubscriptionPlan;
};
export declare function readDeepcodePlusSettings(settingsPath?: string): DeepcodePlusSettings;
export declare function readDeepcodePlusApiKey(settingsPath?: string): string | undefined;
export declare const DEEPCODE_PLUS_BASE_URL = "https://deepcode.vegamo.cn/plugin/openai";
export type PlusSubscriptionStatus = "api only" | "full ability" | "unknown";
export type OpenAIConnection = {
    apiKey?: string;
    baseURL: string;
    usingPlus: boolean;
    configurationError?: string;
};
export type OpenAIConnectionContext = {
    connection: OpenAIConnection;
    plusApiKey?: string;
};
export declare function resolveOpenAIConnection(settings: {
    apiKey?: string;
    baseURL: string;
}, plusApiKey?: string, subscriptionPlan?: DeepcodePlusSettings["subscriptionPlan"], status?: PlusSubscriptionStatus): OpenAIConnection;
type ProbeFetch = (url: string, options: {
    method: "GET";
    headers: Record<string, string>;
    signal: AbortSignal;
    redirect: "manual";
}) => Promise<{
    status: number;
    body?: {
        cancel(): Promise<void>;
    } | null;
}>;
export declare function checkPlusSubscription(apiKey: string, signal?: AbortSignal, fetcher?: ProbeFetch, timeoutMs?: number): Promise<PlusSubscriptionStatus>;
/** Keep the selected credentials stable for every LLM call within a turn. */
export declare function withPlusSubscription(getSettings: () => {
    apiKey?: string;
    baseURL: string;
}, buildClient: (context: OpenAIConnectionContext) => OpenAIClientResult, dependencies?: {
    readSettings?: () => DeepcodePlusSettings;
    checkSubscription?: (apiKey: string, signal?: AbortSignal) => Promise<PlusSubscriptionStatus>;
}): CreateOpenAIClient;
export {};
//# sourceMappingURL=plus-subscription.d.ts.map