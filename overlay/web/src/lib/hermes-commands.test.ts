import { describe, expect, it } from "vitest";

import {
  commandForLine,
  HERMES_COMMANDS,
  isCommandQuery,
  matchCommands,
  type HermesCommand,
} from "./hermes-commands";

const SKILL: HermesCommand = {
  category: "Kỹ năng",
  description: "Kỹ năng cài thêm",
  name: "modelling-helper",
  vi: "Kỹ năng cài thêm",
};

describe("the baked catalog", () => {
  it("carries the whole v0.20.6 registry", () => {
    expect(HERMES_COMMANDS.length).toBeGreaterThan(80);
  });

  it("has no duplicate command names", () => {
    const names = HERMES_COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("never lets two commands claim the same alias", () => {
    const owners = new Map<string, string>();
    for (const command of HERMES_COMMANDS) {
      for (const alias of command.aliases ?? []) {
        expect(owners.get(alias)).toBeUndefined();
        owners.set(alias, command.name);
      }
    }
    // An alias must not shadow another command's real name either.
    const names = new Set(HERMES_COMMANDS.map((command) => command.name));
    for (const alias of owners.keys()) expect(names.has(alias)).toBe(false);
  });

  it("describes every command in both languages", () => {
    const undescribed = HERMES_COMMANDS.filter(
      (command) => !command.description.trim() || !command.vi.trim(),
    );
    expect(undescribed).toEqual([]);
  });

  it("leads with the everyday commands", () => {
    const firstOrdinary = HERMES_COMMANDS.findIndex((c) => !c.common);
    const lastCommon = HERMES_COMMANDS.map((c) => !!c.common).lastIndexOf(true);
    expect(lastCommon).toBeLessThan(firstOrdinary);
    expect(HERMES_COMMANDS[0].name).toBe("new");
  });

  it("marks a useful set as everyday", () => {
    const common = HERMES_COMMANDS.filter((c) => c.common).map((c) => c.name);
    expect(common).toContain("model");
    expect(common).toContain("status");
    expect(common.length).toBeGreaterThan(10);
    expect(common.length).toBeLessThan(HERMES_COMMANDS.length / 2);
  });

  it("flags the pickers that only the TUI can draw", () => {
    const needTerminal = HERMES_COMMANDS.filter(
      (command) => command.needsTerminal,
    ).map((command) => command.name);
    expect(needTerminal).toContain("model");
    expect(needTerminal).toContain("skills");
    expect(needTerminal).not.toContain("status");
  });
});

describe("isCommandQuery", () => {
  it("is true while the name is still being typed", () => {
    expect(isCommandQuery("/")).toBe(true);
    expect(isCommandQuery("/mod")).toBe(true);
    expect(isCommandQuery("/replay-diff")).toBe(true);
  });

  it("is false once an argument starts, or for ordinary prose", () => {
    expect(isCommandQuery("/model gpt")).toBe(false);
    expect(isCommandQuery("chào em")).toBe(false);
    expect(isCommandQuery("tỉ lệ 3/4")).toBe(false);
    expect(isCommandQuery("")).toBe(false);
  });
});

describe("matchCommands", () => {
  it("puts the exact name first", () => {
    expect(matchCommands("/model")[0].name).toBe("model");
  });

  it("ranks a prefix hit above a description hit", () => {
    const names = matchCommands("/sess").map((command) => command.name);
    expect(names[0]).toBe("sessions");
  });

  it("matches an alias", () => {
    const names = matchCommands("/ctx").map((command) => command.name);
    expect(names[0]).toBe("context");
  });

  it("returns everything for a bare slash", () => {
    expect(matchCommands("/")).toHaveLength(HERMES_COMMANDS.length);
  });

  it("searches the Vietnamese explanation too", () => {
    const names = matchCommands("nén ngữ cảnh").map((c) => c.name);
    expect(names).toContain("compress");
  });

  it("includes the skills folded in at call time", () => {
    const merged = [...HERMES_COMMANDS, SKILL];
    const names = matchCommands("/modelling", merged).map((c) => c.name);
    expect(names).toContain("modelling-helper");
  });
});

describe("commandForLine", () => {
  it("reads the command out of a line with arguments", () => {
    expect(commandForLine("/model gpt-5 --global")?.name).toBe("model");
  });

  it("resolves an alias to its command", () => {
    expect(commandForLine("/ctx")?.name).toBe("context");
    expect(commandForLine("/upgrade")?.name).toBe("subscription");
  });

  it("returns null for prose or an unknown command", () => {
    expect(commandForLine("tóm tắt giúp anh")).toBeNull();
    expect(commandForLine("/khong-co-lenh-nay")).toBeNull();
  });
});
