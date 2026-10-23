import { type SpawnOptions } from "child_process";
type NotifyChildProcess = {
    once(event: "error", listener: (error: NodeJS.ErrnoException) => void): NotifyChildProcess;
    unref(): void;
};
export type NotifySpawn = (command: string, args: string[], options: Pick<SpawnOptions, "cwd" | "detached" | "env" | "stdio">) => NotifyChildProcess;
export declare function formatDurationSeconds(durationMs: number): string;
export type NotifyContext = {
    status?: string;
    failReason?: string;
    body?: string;
    title?: string;
};
export declare function buildNotifyEnv(durationMs: number, baseEnv?: NodeJS.ProcessEnv, context?: NotifyContext): NodeJS.ProcessEnv;
export declare function launchNotifyScript(notifyPath: string | undefined, durationMs: number, workingDirectory?: string, spawnProcess?: NotifySpawn, configuredEnv?: Record<string, string>, context?: NotifyContext): void;
export {};
//# sourceMappingURL=notify.d.ts.map