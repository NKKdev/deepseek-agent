import { z } from "zod";
import { executeValidatedTool } from "../common/validate.js";
const skillSchema = z.strictObject({
    name: z.string().trim().min(1, "name must not be empty."),
});
export async function handleSkillTool(args, context) {
    return executeValidatedTool("skill", skillSchema, args, context, async (input, toolContext) => {
        if (!toolContext.onLoadSkill) {
            return {
                ok: false,
                name: "skill",
                error: "Skill loading is not available in this context.",
            };
        }
        return toolContext.onLoadSkill(input.name);
    });
}
