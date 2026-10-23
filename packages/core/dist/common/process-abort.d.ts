import type { ChildProcess } from "child_process";
/** Keep the listener for background processes until they exit, not just until the tool returns. */
export declare function bindProcessAbort(child: ChildProcess, signal?: AbortSignal): void;
//# sourceMappingURL=process-abort.d.ts.map