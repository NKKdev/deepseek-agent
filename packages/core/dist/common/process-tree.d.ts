type TaskkillSpawnSync = (command: string, args: string[], options: {
    stdio: "ignore";
    windowsHide: true;
}) => {
    status: number | null;
    error?: Error;
};
export type KillProcessTreeDeps = {
    platform?: NodeJS.Platform;
    killPid?: (pid: number, signal: NodeJS.Signals) => void;
    runTaskkill?: (pid: number) => boolean;
    killGroupOnNonWindows?: boolean;
};
export declare function killProcessTree(pid: number, signal?: NodeJS.Signals, deps?: KillProcessTreeDeps): boolean;
export declare function runWindowsTaskkill(pid: number, spawnSyncImpl?: TaskkillSpawnSync): boolean;
export {};
//# sourceMappingURL=process-tree.d.ts.map