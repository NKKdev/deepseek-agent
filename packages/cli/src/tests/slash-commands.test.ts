import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSlashCommands,
  filterSlashCommands,
  findExactSlashCommand,
  formatSlashCommandDescription,
  formatSlashCommandLabel,
} from "../ui";
import type { SkillInfo } from "@vegamo/deepcode-core";

const skills: SkillInfo[] = [
  { name: "skill-writer", path: "~/.agents/skills/skill-writer/SKILL.md", description: "Write a SKILL.md" },
  { name: "code-review", path: "~/.agents/skills/code-review/SKILL.md", description: "Review code" },
];

test("buildSlashCommands prefixes skills before built-ins", () => {
  const items = buildSlashCommands(skills);
  assert.equal(items[0].kind, "skill");
  assert.equal(items[0].name, "skill-writer");
  const builtinNames = items.filter((i) => i.kind !== "skill").map((i) => i.name);
  assert.deepEqual(builtinNames, [
    "skills",
    "model",
    "plan",
    "new",
    "init",
    "resume",
    "fork",
    "continue",
    "undo",
    "mcp",
    "raw",
    "exit",
  ]);
});

test("filterSlashCommands matches partial prefixes", () => {
  const items = buildSlashCommands(skills);
  const matched = filterSlashCommands(items, "/skil").map((i) => i.name);
  assert.deepEqual(matched, ["skill-writer", "skills"]);
});

test("filterSlashCommands ranks /model before /commondao for /mo", () => {
  const items = buildSlashCommands([
    { name: "commondao", path: "/skills/commondao/SKILL.md", description: "CommonDAO guide" },
  ]);
  assert.deepEqual(
    filterSlashCommands(items, "/mo").map((item) => item.name),
    ["model", "commondao"]
  );
});

test("filterSlashCommands preserves order within match groups without mutating input", () => {
  const items = buildSlashCommands(
    ["commondao", "motion", "demo", "model-helper"].map((name) => ({
      name,
      path: `/skills/${name}/SKILL.md`,
      description: name,
    }))
  );
  const original = [...items];
  assert.deepEqual(
    filterSlashCommands(items, "/mo").map((item) => item.name),
    ["motion", "model-helper", "model", "commondao", "demo"]
  );
  assert.deepEqual(items, original);
});

test("filterSlashCommands matches and prioritizes prefixes case-insensitively", () => {
  const items = buildSlashCommands(
    ["ComMonDAO", "Motion"].map((name) => ({
      name,
      path: `/skills/${name}/SKILL.md`,
      description: name,
    }))
  );
  assert.deepEqual(
    filterSlashCommands(items, "/MO").map((item) => item.name),
    ["Motion", "model", "ComMonDAO"]
  );
});

test("filterSlashCommands returns all entries on bare slash", () => {
  const items = buildSlashCommands(skills);
  const matched = filterSlashCommands(items, "/");
  assert.deepEqual(matched, items);
});

test("filterSlashCommands returns nothing when no names match", () => {
  assert.deepEqual(filterSlashCommands(buildSlashCommands(skills), "/missing"), []);
});

test("filterSlashCommands returns nothing for non-slash tokens", () => {
  const items = buildSlashCommands(skills);
  assert.deepEqual(filterSlashCommands(items, "skill"), []);
});

test("findExactSlashCommand returns null when nothing matches", () => {
  const items = buildSlashCommands(skills);
  assert.equal(findExactSlashCommand(items, "/missing"), null);
});

test("findExactSlashCommand returns built-in /new", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/new");
  assert.ok(item);
  assert.equal(item?.kind, "new");
});

test("findExactSlashCommand returns built-in /init", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/init");
  assert.ok(item);
  assert.equal(item?.kind, "init");
  assert.equal(item?.description, "Initialize an AGENTS.md file with instructions for LLM");
});

test("findExactSlashCommand returns built-in /continue", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/continue");
  assert.ok(item);
  assert.equal(item?.kind, "continue");
});

test("findExactSlashCommand returns built-in /undo", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/undo");
  assert.ok(item);
  assert.equal(item?.kind, "undo");
});

test("findExactSlashCommand returns built-in /skills", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/skills");
  assert.ok(item);
  assert.equal(item?.kind, "skills");
});

test("findExactSlashCommand returns built-in /model", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/model");
  assert.ok(item);
  assert.equal(item?.kind, "model");
});

test("findExactSlashCommand returns built-in /plan", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/plan");
  assert.ok(item);
  assert.equal(item?.kind, "plan");
});

test("findExactSlashCommand returns built-in /raw", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/raw");
  assert.ok(item);
  assert.equal(item?.kind, "raw");
});

test("findExactSlashCommand returns the matching skill", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/code-review");
  assert.ok(item);
  assert.equal(item?.kind, "skill");
  assert.equal(item?.skill?.name, "code-review");
});

test("formatSlashCommandDescription keeps descriptions on one line", () => {
  assert.equal(formatSlashCommandDescription("Line one\n  line two"), "Line one line two");
});

test("formatSlashCommandLabel marks loaded skills", () => {
  const items = buildSlashCommands([
    { name: "loaded", path: "/skills/loaded/SKILL.md", description: "Loaded skill", isLoaded: true },
    { name: "fresh", path: "/skills/fresh/SKILL.md", description: "Fresh skill" },
  ]);

  assert.equal(formatSlashCommandLabel(items[0]), "/loaded ✓");
  assert.equal(formatSlashCommandLabel(items[1]), "/fresh");
});
