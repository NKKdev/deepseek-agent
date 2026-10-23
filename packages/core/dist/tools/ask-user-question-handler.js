export async function handleAskUserQuestionTool(args, _context) {
    const questions = parseQuestions(args.questions);
    if (!questions.ok) {
        return {
            ok: false,
            name: "AskUserQuestion",
            error: questions.error,
        };
    }
    const metadata = {
        kind: "ask_user_question",
        questions: questions.value,
    };
    return {
        ok: true,
        name: "AskUserQuestion",
        output: buildQuestionSummary(questions.value),
        metadata,
        awaitUserResponse: true,
    };
}
function parseQuestions(raw) {
    if (!Array.isArray(raw) || raw.length === 0) {
        return {
            ok: false,
            error: '"questions" must be a non-empty array.',
        };
    }
    const questions = [];
    for (let index = 0; index < raw.length; index += 1) {
        const item = raw[index];
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            return {
                ok: false,
                error: `Question at index ${index} must be an object.`,
            };
        }
        const question = typeof item.question === "string"
            ? item.question.trim()
            : "";
        if (!question) {
            return {
                ok: false,
                error: `Question at index ${index} is missing a non-empty "question" string.`,
            };
        }
        const rawOptions = item.options;
        if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
            return {
                ok: false,
                error: `Question at index ${index} must include a non-empty "options" array.`,
            };
        }
        const options = [];
        for (let optionIndex = 0; optionIndex < rawOptions.length; optionIndex += 1) {
            const option = rawOptions[optionIndex];
            if (!option || typeof option !== "object" || Array.isArray(option)) {
                return {
                    ok: false,
                    error: `Option ${optionIndex} for question ${index} must be an object.`,
                };
            }
            const label = typeof option.label === "string" ? option.label.trim() : "";
            if (!label) {
                return {
                    ok: false,
                    error: `Option ${optionIndex} for question ${index} is missing a non-empty "label" string.`,
                };
            }
            const description = typeof option.description === "string"
                ? option.description.trim()
                : undefined;
            options.push({
                label,
                description: description || undefined,
            });
        }
        const multiSelect = typeof item.multiSelect === "boolean"
            ? item.multiSelect
            : undefined;
        questions.push({
            question,
            multiSelect,
            options,
        });
    }
    return {
        ok: true,
        value: questions,
    };
}
function buildQuestionSummary(questions) {
    const lines = ["Waiting for user input."];
    questions.forEach((item, index) => {
        lines.push("");
        lines.push(`${index + 1}. ${item.question}`);
        lines.push(`   Mode: ${item.multiSelect ? "multi-select" : "single-select"}`);
        item.options.forEach((option) => {
            lines.push(`   - ${option.label}`);
            if (option.description) {
                lines.push(`     ${option.description}`);
            }
        });
        lines.push("   - Other");
    });
    return lines.join("\n");
}
