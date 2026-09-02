import { describe, expect, it } from "vitest";

import {
  mergeCommandCatalog,
  parseCommandCatalog,
} from "./chat-command-catalog";
import { HERMES_COMMANDS, type HermesCommand } from "./hermes-commands";

/** A stand-in baked list, so the tests do not move when the real one does. */
const BAKED: HermesCommand[] = [
  {
    category: "Phiên",
    common: true,
    description: "Start a new session (usage: /new [name])",
    name: "new",
    vi: "Mở phiên mới.",
  },
  {
    aliases: ["ctx"],
    category: "Phiên",
    description: "Show context",
    name: "context",
    needsTerminal: true,
    vi: "Xem ngữ cảnh.",
  },
];

/** The shape `commands.catalog` answers with. */
function payload(options: {
  categories?: Array<{ name: string; pairs: unknown[] }>;
  pairs?: unknown[];
  skills?: Record<string, unknown>;
  skill_count?: number;
  warning?: string;
} = {}) {
  return {
    canon: {},
    categories: options.categories ?? [],
    commands: {},
    pairs: options.pairs ?? [],
    skill_count: options.skill_count ?? 0,
    skills: options.skills ?? {},
    sub: {},
    warning: options.warning ?? "",
  };
}

describe("parseCommandCatalog", () => {
  it("reads categorised rows and translates the category label", () => {
    const entries = parseCommandCatalog(
      payload({
        categories: [
          { name: "Session", pairs: [["/new", "Start a new session"]] },
          { name: "Tools & Skills", pairs: [["/tools", "Manage tools"]] },
        ],
      }),
    );
    expect(entries).toEqual([
      { category: "Phiên", description: "Start a new session", name: "new" },
      {
        category: "Công cụ & Kỹ năng",
        description: "Manage tools",
        name: "tools",
      },
    ]);
  });

  it("keeps an unfamiliar category label rather than dropping the row", () => {
    const entries = parseCommandCatalog(
      payload({
        categories: [{ name: "Weather", pairs: [["/rain", "Make it rain"]] }],
      }),
    );
    expect(entries[0]).toMatchObject({ category: "Weather", name: "rain" });
  });

  it("picks up rows that only appear in the flat pairs list", () => {
    const entries = parseCommandCatalog(payload({ pairs: [["/solo", "Alone"]] }));
    expect(entries).toEqual([
      { category: undefined, description: "Alone", name: "solo" },
    ]);
  });

  it("does not list a command twice when pairs repeats a categorised row", () => {
    const entries = parseCommandCatalog(
      payload({
        categories: [{ name: "Session", pairs: [["/new", "Start a session"]] }],
        pairs: [["/new", "Start a session"]],
      }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("Phiên");
  });

  it("files skills under Kỹ năng however they arrived", () => {
    const entries = parseCommandCatalog(
      payload({
        pairs: [["/deep-research", "Research a topic"]],
        skills: { "/deep-research": { origin: "hub", usage: 3 } },
      }),
    );
    expect(entries[0]).toMatchObject({
      category: "Kỹ năng",
      name: "deep-research",
    });
  });

  it("ignores junk rows instead of trusting the wire", () => {
    expect(
      parseCommandCatalog(
        payload({
          pairs: [["no-slash", "x"], ["/ok", "fine"], "nonsense", [], [42, 7]],
        }),
      ),
    ).toEqual([{ category: undefined, description: "fine", name: "ok" }]);
  });

  it("returns nothing for a payload that is not one", () => {
    expect(parseCommandCatalog(null)).toEqual([]);
    expect(parseCommandCatalog("catalog")).toEqual([]);
    expect(parseCommandCatalog([])).toEqual([]);
  });
});

describe("mergeCommandCatalog", () => {
  it("keeps the baked list when the catalog is empty", () => {
    const merged = mergeCommandCatalog(payload(), BAKED);
    expect(merged.commands).toBe(BAKED);
    expect(merged.added).toEqual([]);
  });

  it("keeps our Vietnamese text and flags, refreshing only the English line", () => {
    const merged = mergeCommandCatalog(
      payload({
        categories: [
          {
            name: "Session",
            pairs: [
              ["/new", "Start a brand new session (usage: /new [name])"],
              ["/context", "Show context"],
            ],
          },
        ],
      }),
      BAKED,
    );
    const fresh = merged.commands.find((command) => command.name === "new");
    expect(fresh?.description).toBe(
      "Start a brand new session (usage: /new [name])",
    );
    expect(fresh?.vi).toBe("Mở phiên mới.");
    expect(fresh?.common).toBe(true);
    expect(fresh?.category).toBe("Phiên");
  });

  it("adds a command the baked list never had, tagged as new", () => {
    const merged = mergeCommandCatalog(
      payload({
        categories: [
          { name: "Session", pairs: [["/new", "x"], ["/context", "y"]] },
          {
            name: "Plugin commands",
            pairs: [["/standup", "Post the standup (usage: /standup [team])"]],
          },
        ],
      }),
      BAKED,
    );
    const added = merged.commands.find((command) => command.name === "standup");
    expect(added).toMatchObject({
      args: "[team]",
      category: "Tiện ích",
      source: "gateway",
    });
    expect(added?.vi).toBe("Post the standup");
    expect(merged.added).toEqual(["standup"]);
  });

  it("matches a baked command through its alias", () => {
    const merged = mergeCommandCatalog(
      payload({
        categories: [{ name: "Session", pairs: [["/new", "x"], ["/ctx", "y"]] }],
      }),
      BAKED,
    );
    expect(merged.added).toEqual([]);
    expect(merged.dropped).toEqual([]);
    expect(merged.commands).toHaveLength(2);
  });

  it("drops a baked command this install no longer has", () => {
    const merged = mergeCommandCatalog(
      payload({ categories: [{ name: "Session", pairs: [["/new", "x"]] }] }),
      BAKED,
    );
    expect(merged.dropped).toEqual(["context"]);
    expect(merged.commands.map((command) => command.name)).toEqual(["new"]);
  });

  it("drops nothing when the catalog came back without categories", () => {
    // A partial answer must not be read as "the install lost 94 commands".
    const merged = mergeCommandCatalog(payload({ pairs: [["/new", "x"]] }), BAKED);
    expect(merged.dropped).toEqual([]);
    expect(merged.commands).toHaveLength(2);
  });

  it("keeps everyday commands ahead of whatever the gateway added", () => {
    const merged = mergeCommandCatalog(
      payload({
        categories: [
          {
            name: "Session",
            pairs: [["/aaa", "first alphabetically"], ["/new", "x"], ["/ctx", "y"]],
          },
        ],
      }),
      BAKED,
    );
    expect(merged.commands.map((command) => command.name)).toEqual([
      "new",
      "context",
      "aaa",
    ]);
  });

  it("passes the gateway's own warning and skill count through", () => {
    const merged = mergeCommandCatalog(
      payload({
        categories: [{ name: "Session", pairs: [["/new", "x"], ["/ctx", "y"]] }],
        skill_count: 12,
        warning: "skill discovery unavailable: boom",
      }),
      BAKED,
    );
    expect(merged.skillCount).toBe(12);
    expect(merged.warning).toBe("skill discovery unavailable: boom");
  });

  it("survives the real baked list against a realistic catalog", () => {
    const merged = mergeCommandCatalog(
      payload({
        categories: [
          {
            name: "Session",
            pairs: HERMES_COMMANDS.map((command) => [
              `/${command.name}`,
              command.description,
            ]),
          },
        ],
        pairs: [["/brand-new", "Something this build added"]],
      }),
      HERMES_COMMANDS,
    );
    expect(merged.dropped).toEqual([]);
    expect(merged.added).toEqual(["brand-new"]);
    expect(merged.commands).toHaveLength(HERMES_COMMANDS.length + 1);
  });
});
