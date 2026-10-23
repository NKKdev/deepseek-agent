import { z } from "zod";
import { executeValidatedTool } from "../common/validate.js";
const updatePlanSchema = z.strictObject({
    plan: z.string().trim().min(1, "plan must not be empty."),
    explanation: z.string().trim().optional(),
});
export async function handleUpdatePlanTool(args, _context) {
    return executeValidatedTool("UpdatePlan", updatePlanSchema, args, _context, async (input) => ({
        ok: true,
        name: "UpdatePlan",
        output: "Plan updated.",
        metadata: {
            plan: input.plan,
            ...(input.explanation ? { explanation: input.explanation } : {}),
        },
    }));
}
