import { killProcessTree } from "./process-tree.js";
/** Keep the listener for background processes until they exit, not just until the tool returns. */
export function bindProcessAbort(child, signal) {
    if (!signal)
        return;
    const abort = () => {
        if (typeof child.pid === "number")
            killProcessTree(child.pid, "SIGKILL");
    };
    child.once("close", () => signal.removeEventListener("abort", abort));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted)
        abort();
}
