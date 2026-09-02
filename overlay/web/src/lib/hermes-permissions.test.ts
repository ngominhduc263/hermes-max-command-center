import { describe, expect, it } from "vitest";

import {
  addDenyRule,
  approvalMode,
  APPROVAL_MODE_VI,
  buildConfigPatch,
  denyRules,
  denyRuleWarning,
  describePermission,
  grantedPermissions,
  normalizeDenyRule,
  PATTERN_VI,
  rawAllowlist,
  removeDenyRule,
  revokePermission,
  RISK_VI,
} from "./hermes-permissions";

describe("PATTERN_VI", () => {
  it("covers every pattern key Hermes v0.20.6 can write", () => {
    // 113 keys can reach command_allowlist: 98 from DANGEROUS_PATTERNS, plus
    // the ones `_execution_flag_findings` yields (script/shell exec flags and
    // the eight `arbitrary program execution via <tool> <flag>` expansions),
    // the malformed-payload and gateway-splice descriptions, ssh_config_write,
    // and execute_code — that last one described in describePermission rather
    // than here. Cross-checked against tools/approval.py at build time; the
    // count is pinned so a half-deleted dictionary is caught.
    expect(Object.keys(PATTERN_VI)).toHaveLength(112);
  });

  it("explains the exec-flag family the first release missed", () => {
    // Shipped in v2.18.0 with only DANGEROUS_PATTERNS translated, so a real
    // install showed "script execution via -e/-c flag" untranslated.
    expect(PATTERN_VI["script execution via -e/-c flag"].vi).toContain(
      "python -c",
    );
    expect(PATTERN_VI["shell command via -c/-lc flag"]).toBeDefined();
    expect(
      PATTERN_VI["arbitrary program execution via rg --pre"].risk,
    ).toBe("high");
    expect(PATTERN_VI["ssh_config_write"].risk).toBe("critical");
  });

  it("gives every entry a Vietnamese sentence and a known risk", () => {
    for (const [key, note] of Object.entries(PATTERN_VI)) {
      expect(note.vi.trim(), key).not.toBe("");
      expect(note.vi, key).not.toBe(key);
      expect(RISK_VI[note.risk], key).toBeDefined();
    }
  });

  it("rates deleting and disk-wiping as the worst thing on the list", () => {
    expect(PATTERN_VI["delete in root path"].risk).toBe("critical");
    expect(PATTERN_VI["recursive delete"].risk).toBe("critical");
    expect(PATTERN_VI["wipe disk (Clear-Disk)"].risk).toBe("critical");
  });
});

describe("describePermission", () => {
  it("translates a known pattern key", () => {
    const entry = describePermission("delete in root path");
    expect(entry).toMatchObject({ kind: "pattern", risk: "critical" });
    expect(entry.vi).toContain("thư mục gốc");
  });

  it("trims what it was given so the key still matches config.yaml", () => {
    expect(describePermission("  recursive delete  ").key).toBe("recursive delete");
  });

  it("names the rule behind a tirith entry", () => {
    const entry = describePermission("tirith:secret-exfil");
    expect(entry).toMatchObject({ kind: "security", risk: "critical" });
    expect(entry.vi).toContain("secret-exfil");
  });

  it("names the tool behind a plugin rule", () => {
    const entry = describePermission("plugin_rule:web_search:a1b2c3");
    expect(entry).toMatchObject({ kind: "plugin" });
    expect(entry.vi).toContain("web_search");
  });

  it("recognises execute_code", () => {
    expect(describePermission("execute_code")).toMatchObject({
      kind: "code",
      risk: "critical",
    });
  });

  it("reads a hand-written glob as a command pattern", () => {
    const entry = describePermission("cargo *");
    expect(entry.kind).toBe("glob");
    expect(entry.vi).toContain("cargo *");
  });

  it("reads a Claude Code import as a glob too", () => {
    expect(describePermission("Bash(npm run test:all)").kind).toBe("glob");
  });

  it("reads an old regex-format entry as the permission it really is", () => {
    // An allowlist written by an older Hermes holds the raw regex; the panel
    // must not present that as a glob matching literal `(python...` text.
    const entry = describePermission("(python[23]?|perl|ruby|node)\\s+-[ec]\\s+");
    expect(entry.kind).toBe("pattern");
    expect(entry.risk).toBe("high");
    expect(entry.vi).toContain("python -c");
    expect(entry.vi).toContain("mục cũ");
  });

  it("does not mistake a leftover regex for a command glob", () => {
    const entry = describePermission("(foo|bar)\\s+baz");
    expect(entry.kind).not.toBe("glob");
  });

  it("says so plainly for a key it has never seen", () => {
    const entry = describePermission("some future pattern");
    expect(entry.kind).toBe("unknown");
    expect(entry.vi).toContain("chưa có mô tả tiếng Việt");
  });
});

describe("grantedPermissions", () => {
  it("lists the most dangerous grant first", () => {
    const config = {
      command_allowlist: [
        "docker restart/stop/kill (container lifecycle)", // medium
        "git reset --hard (destroys uncommitted changes)", // high
        "recursive delete", // critical
      ],
    };
    expect(grantedPermissions(config).map((e) => e.risk)).toEqual([
      "critical",
      "high",
      "medium",
    ]);
  });

  it("drops duplicates and blank entries", () => {
    const config = {
      command_allowlist: ["recursive delete", "  recursive delete  ", "", "   "],
    };
    expect(grantedPermissions(config)).toHaveLength(1);
  });

  it("returns nothing when the key is absent or the wrong shape", () => {
    expect(grantedPermissions({})).toEqual([]);
    expect(grantedPermissions({ command_allowlist: "nope" })).toEqual([]);
    expect(grantedPermissions(null)).toEqual([]);
  });

  it("ignores non-string members rather than rendering them", () => {
    expect(
      grantedPermissions({ command_allowlist: [42, null, "recursive delete"] }),
    ).toHaveLength(1);
  });
});

describe("approvalMode", () => {
  it("reads the configured mode", () => {
    expect(approvalMode({ approvals: { mode: "manual" } })).toBe("manual");
    expect(approvalMode({ approvals: { mode: "  OFF  " } })).toBe("off");
  });

  it("defaults to smart, the same default Hermes uses", () => {
    expect(approvalMode({})).toBe("smart");
    expect(approvalMode({ approvals: {} })).toBe("smart");
    expect(approvalMode(null)).toBe("smart");
    expect(approvalMode({ approvals: { mode: "nonsense" } })).toBe("smart");
  });

  it("treats an unquoted YAML `off` as the mode, not as false", () => {
    // `mode: off` in config.yaml parses as the boolean false under YAML 1.1;
    // Hermes normalises that back to the string, so this must agree.
    expect(approvalMode({ approvals: { mode: false } })).toBe("off");
    expect(approvalMode({ approvals: { mode: true } })).toBe("manual");
  });

  it("describes all three modes for the picker", () => {
    expect(APPROVAL_MODE_VI.map((m) => m.mode)).toEqual([
      "manual",
      "smart",
      "off",
    ]);
    for (const entry of APPROVAL_MODE_VI) {
      expect(entry.label.trim()).not.toBe("");
      expect(entry.vi.trim()).not.toBe("");
    }
  });
});

describe("denyRules", () => {
  it("reads and de-duplicates the block list", () => {
    expect(
      denyRules({ approvals: { deny: ["rm -rf *", " RM -RF * ", "shutdown *"] } }),
    ).toEqual(["rm -rf *", "shutdown *"]);
  });

  it("returns nothing for an absent or malformed list", () => {
    expect(denyRules({})).toEqual([]);
    expect(denyRules({ approvals: { deny: "rm -rf *" } })).toEqual([]);
    expect(denyRules({ approvals: null })).toEqual([]);
  });
});

describe("deny rule editing", () => {
  it("collapses whitespace on the way in", () => {
    expect(normalizeDenyRule("  rm   -rf   *  ")).toBe("rm -rf *");
  });

  it("adds a rule, ignoring case-only duplicates", () => {
    const rules = addDenyRule(["rm -rf *"], "RM -RF *");
    expect(rules).toEqual(["rm -rf *"]);
    expect(addDenyRule(["rm -rf *"], "shutdown *")).toEqual([
      "rm -rf *",
      "shutdown *",
    ]);
  });

  it("refuses to add an empty rule", () => {
    const rules = ["rm -rf *"];
    expect(addDenyRule(rules, "   ")).toBe(rules);
  });

  it("removes a rule regardless of case or padding", () => {
    expect(removeDenyRule(["rm -rf *", "shutdown *"], "  RM -RF *  ")).toEqual([
      "shutdown *",
    ]);
  });

  it("warns when a rule has no wildcard, because it would barely match", () => {
    expect(denyRuleWarning("rm -rf")).toContain("Thêm dấu *");
    expect(denyRuleWarning("rm -rf *")).toBeNull();
    expect(denyRuleWarning("   ")).toBeNull();
  });
});

describe("revokePermission", () => {
  it("removes only the named grant", () => {
    expect(
      revokePermission(["recursive delete", "SQL DROP"], "recursive delete"),
    ).toEqual(["SQL DROP"]);
  });

  it("leaves the list alone when nothing matches", () => {
    expect(revokePermission(["SQL DROP"], "recursive delete")).toEqual([
      "SQL DROP",
    ]);
  });

  it("matches the trimmed key the panel shows", () => {
    expect(revokePermission(["  recursive delete  "], "recursive delete")).toEqual(
      [],
    );
  });
});

describe("rawAllowlist", () => {
  it("keeps the on-disk order so a patch does not reshuffle the file", () => {
    expect(
      rawAllowlist({ command_allowlist: ["z pattern", "a pattern"] }),
    ).toEqual(["z pattern", "a pattern"]);
  });

  it("skips members that are not usable strings", () => {
    expect(rawAllowlist({ command_allowlist: ["ok", "", 7, null] })).toEqual([
      "ok",
    ]);
  });
});

describe("buildConfigPatch", () => {
  it("sends only what changed, so the merge cannot clobber the rest", () => {
    expect(buildConfigPatch({ allowlist: [] })).toEqual({
      command_allowlist: [],
    });
    expect(buildConfigPatch({ mode: "manual" })).toEqual({
      approvals: { mode: "manual" },
    });
    expect(buildConfigPatch({ deny: ["rm -rf *"] })).toEqual({
      approvals: { deny: ["rm -rf *"] },
    });
  });

  it("puts both approval keys under one object", () => {
    expect(buildConfigPatch({ deny: ["x *"], mode: "off" })).toEqual({
      approvals: { deny: ["x *"], mode: "off" },
    });
  });

  it("is empty when nothing was asked for", () => {
    expect(buildConfigPatch({})).toEqual({});
  });

  it("copies the arrays so later edits cannot mutate a sent patch", () => {
    const allowlist = ["recursive delete"];
    const patch = buildConfigPatch({ allowlist });
    allowlist.push("SQL DROP");
    expect(patch.command_allowlist).toEqual(["recursive delete"]);
  });
});
