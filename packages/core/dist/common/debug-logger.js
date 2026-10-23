import * as fs from "fs";
import * as os from "os";
import * as path from "path";
const DEBUG_LOG_FILE = "debug.log";
export function logOpenAIChatCompletionDebug(entry) {
    try {
        const logPath = getDebugLogPath();
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, `${JSON.stringify(toSerializable(entry))}\n`, "utf8");
    }
    catch {
        // Debug logging must never affect CLI behavior.
    }
}
export function getDebugLogPath() {
    return path.join(os.homedir(), ".deepcode", "logs", DEBUG_LOG_FILE);
}
export function normalizeDebugError(error) {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }
    return {
        name: "UnknownError",
        message: String(error),
    };
}
function toSerializable(value) {
    const seen = new WeakSet();
    function walk(current) {
        if (typeof current === "bigint") {
            return current.toString();
        }
        if (current instanceof Error) {
            return normalizeDebugError(current);
        }
        if (!current || typeof current !== "object") {
            return current;
        }
        if (seen.has(current)) {
            return "[Circular]";
        }
        seen.add(current);
        if (Array.isArray(current)) {
            return current.map(walk);
        }
        const result = {};
        for (const [key, val] of Object.entries(current)) {
            result[key] = walk(val);
        }
        return result;
    }
    return walk(value);
}
