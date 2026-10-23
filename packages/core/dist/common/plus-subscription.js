import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fetch as undiciFetch } from "undici";
export const DEEPCODE_PLUS_LEGACY_HOST = "https://deepcode.vegamo.cn";
export const DEEPCODE_PLUS_HOST = "https://www.deepcodeplus.com";
export const DEEPCODE_PLUS_LLM_HOST = "https://chat.deepcodeplus.com";
/** Undefined means unconfigured; all explicitly configured values must be valid. */
export function normalizePlusApiKey(value, settingsPath = "~/.deepcode-plus/settings.json") {
    if (value === undefined)
        return undefined;
    const key = typeof value === "string" ? value.trim() : "";
    const length = Array.from(key.slice(3)).length;
    if (!key.startsWith("sk-") || (length !== 24 && length !== 26)) {
        throw new Error(`Invalid PLUS_API_KEY in ${settingsPath}: expected "sk-" followed by 24 or 26 characters.`);
    }
    return key;
}
export function resolvePlusHost(apiKey) {
    const key = normalizePlusApiKey(apiKey);
    return key && Array.from(key.slice(3)).length === 26 ? DEEPCODE_PLUS_HOST : DEEPCODE_PLUS_LEGACY_HOST;
}
export function resolvePlusLlmHost(apiKey) {
    return resolvePlusHost(apiKey) === DEEPCODE_PLUS_HOST ? DEEPCODE_PLUS_LLM_HOST : DEEPCODE_PLUS_LEGACY_HOST;
}
export function getDeepcodePlusSettingsPath() {
    return path.join(os.homedir(), ".deepcode-plus", "settings.json");
}
export function readDeepcodePlusSettings(settingsPath = getDeepcodePlusSettingsPath()) {
    let settings;
    try {
        settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    }
    catch {
        return { subscriptionPlan: "default" };
    }
    return {
        apiKey: normalizePlusApiKey(settings?.env?.PLUS_API_KEY, settingsPath),
        subscriptionPlan: settings?.subscriptionPlan === "on" || settings?.subscriptionPlan === "off"
            ? settings.subscriptionPlan
            : "default",
    };
}
export function readDeepcodePlusApiKey(settingsPath = getDeepcodePlusSettingsPath()) {
    return readDeepcodePlusSettings(settingsPath).apiKey;
}
export const DEEPCODE_PLUS_BASE_URL = `${DEEPCODE_PLUS_LEGACY_HOST}/plugin/openai`;
export function resolveOpenAIConnection(settings, plusApiKey, subscriptionPlan = "default", status = "unknown") {
    plusApiKey = normalizePlusApiKey(plusApiKey);
    const baseURL = `${resolvePlusLlmHost(plusApiKey)}/plugin/openai`;
    const regular = { apiKey: settings.apiKey, baseURL: settings.baseURL, usingPlus: false };
    if (subscriptionPlan === "off")
        return regular;
    if (subscriptionPlan === "on" && !plusApiKey) {
        return {
            apiKey: undefined,
            baseURL,
            usingPlus: false,
            configurationError: "PLUS_API_KEY not found. Please configure env.PLUS_API_KEY in ~/.deepcode-plus/settings.json.",
        };
    }
    if (subscriptionPlan === "default" &&
        (!plusApiKey || status === "api only" || (status === "unknown" && settings.apiKey)))
        return regular;
    return { apiKey: plusApiKey, baseURL, usingPlus: true };
}
export async function checkPlusSubscription(apiKey, signal, fetcher = undiciFetch, timeoutMs = 3000) {
    signal?.throwIfAborted();
    apiKey = normalizePlusApiKey(apiKey);
    const baseURL = `${resolvePlusLlmHost(apiKey)}/plugin/openai`;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetcher(`${baseURL}/models`, {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: controller.signal,
            redirect: "manual",
        });
        signal?.throwIfAborted();
        // Only HTTP status matters; release the body without requiring valid JSON.
        await response.body?.cancel().catch(() => { });
        if (response.status === 200)
            return "full ability";
        if (response.status === 401 || response.status === 403)
            return "api only";
        return "unknown";
    }
    catch {
        signal?.throwIfAborted();
        return "unknown";
    }
    finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
    }
}
/** Keep the selected credentials stable for every LLM call within a turn. */
export function withPlusSubscription(getSettings, buildClient, dependencies = {}) {
    const readSettings = dependencies.readSettings ?? readDeepcodePlusSettings;
    const checkSubscription = dependencies.checkSubscription ?? checkPlusSubscription;
    let prepared;
    const resolve = (plus, status) => ({
        connection: resolveOpenAIConnection(getSettings(), plus.apiKey, plus.subscriptionPlan, status),
        plusApiKey: plus.apiKey,
    });
    return Object.assign(() => buildClient(prepared ?? resolve(readSettings(), "unknown")), {
        prepare: async (signal) => {
            signal?.throwIfAborted();
            const settings = readSettings();
            const plus = { ...settings, apiKey: normalizePlusApiKey(settings.apiKey) };
            const status = plus.subscriptionPlan === "default" && plus.apiKey ? await checkSubscription(plus.apiKey, signal) : "unknown";
            signal?.throwIfAborted();
            prepared = resolve(plus, status);
        },
    });
}
