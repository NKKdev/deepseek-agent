export const MAX_PARALLEL_AGENTS = 4;

const ITEM_LINE = /^\s*(?:[-*+]|\d{1,2}[.、)）])\s+(?:\[[ xX]\]\s*)?(\S.*)$/;

function extractList(source) {
  const items = [];
  let current = null;
  let inFence = false;
  for (const line of source.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      if (current) current.push(line);
      continue;
    }
    if (inFence) {
      if (current) current.push(line);
      continue;
    }
    const match = line.match(ITEM_LINE);
    if (match) {
      if (current) items.push(current.join("\n").trim());
      current = [match[1].trim()];
      continue;
    }
    if (current && (/^\s{2,}\S/.test(line) || line.trim() === "")) {
      if (line.trim()) current.push(line.trim());
      continue;
    }
    if (current) {
      items.push(current.join("\n").trim());
      current = null;
    }
  }
  if (current) items.push(current.join("\n").trim());
  return items.filter((item) => item.length >= 4);
}

function extractIntro(source) {
  const lines = [];
  for (const line of source.split("\n")) {
    if (ITEM_LINE.test(line)) break;
    lines.push(line);
  }
  return lines.join("\n").trim();
}

function pack(tasks) {
  const usable = tasks.filter((task) => task.length >= 4);
  if (usable.length <= MAX_PARALLEL_AGENTS) return usable;
  return [...usable.slice(0, MAX_PARALLEL_AGENTS - 1), usable.slice(MAX_PARALLEL_AGENTS - 1).join("\n")];
}

function scope(task, intro) {
  const background = intro && !task.includes(intro) ? `\n背景：${intro}` : "";
  return `${task}${background}\n\n只完成上面这一项。其他项由另外的智能体并行处理，不要改它们要改的文件。`;
}

export function splitParallelTasks(text) {
  const source = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!source) return [];
  const single = [{ title: source.split("\n")[0].slice(0, 48), text: source }];
  const listed = extractList(source);
  const keyword = /并行|分别/.test(source);
  const substantial = listed.length >= 2 && listed.every((item) => item.length >= 18);
  let tasks = [];
  if (listed.length >= 2 && (keyword || substantial)) tasks = listed;
  else if (keyword) {
    tasks = source
      .split(/\n\s*\n|[；;]/)
      .map((part) => part.replace(/^(?:请)?(?:并行|分别)[:：]?\s*/, "").trim())
      .filter((part) => part.length >= 8 && !ITEM_LINE.test(part));
  }
  if (tasks.length < 2) return single;
  const intro = extractIntro(source);
  return pack(tasks).map((task) => ({
    title: task.split("\n")[0].slice(0, 48),
    text: scope(task, intro),
  }));
}
