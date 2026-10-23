export async function handleManageSubagentTool(args, context) {
    if (!context.onManageSubagent) {
        return {
            ok: false,
            name: "ManageSubagent",
            error: "Sub-agent control is not available in this session.",
        };
    }
    const result = await context.onManageSubagent(args);
    if (!result.ok) {
        return {
            ok: false,
            name: "ManageSubagent",
            error: result.error || "Sub-agent control failed.",
        };
    }
    return {
        ok: true,
        name: "ManageSubagent",
        output: result.output || "ok",
    };
}
