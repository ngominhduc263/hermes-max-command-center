/**
 * Fold the gateway's live `commands.catalog` over the baked command list.
 *
 * `hermes-commands.ts` is a snapshot of v0.20.6's registry, hand-annotated in
 * Vietnamese. It goes stale the moment the user runs `hermes update`, installs
 * a plugin, or adds a quick command — and none of those show up in a baked
 * file. The gateway already answers `commands.catalog` with the real thing:
 * registry + TUI extras + quick commands + plugin commands + skills.
 *
 * So the palette asks the gateway and merges:
 *
 *   - a command we already know keeps its Vietnamese text, its `common` flag
 *     and its `needsTerminal` flag, and only refreshes the English one-liner;
 *   - a command we do not know is added, tagged `source: "gateway"` so the UI
 *     can badge it, with the catalog's own description standing in for `vi`;
 *   - a baked command the install no longer has is dropped — but only when the
 *     catalog came back complete, so a half-failed discovery cannot empty the
 *     palette.
 *
 * If the RPC fails at all, the caller keeps the baked list. The palette only
 * ever suggests — whatever is typed still goes to the TUI verbatim — so being
 * a little stale is a cosmetic problem, and being empty is not.
 */

import { HERMES_COMMANDS, type HermesCommand } from "./hermes-commands";

/** Registry/TUI category labels → the Vietnamese ones the sheet groups by. */
export const CATEGORY_VI: Record<string, string> = {
  Configuration: "Cấu hình",
  Exit: "Thoát",
  Info: "Thông tin",
  "Plugin commands": "Tiện ích",
  Session: "Phiên",
  Skills: "Kỹ năng",
  "Tools & Skills": "Công cụ & Kỹ năng",
  TUI: "Giao diện",
  "User commands": "Lệnh riêng của anh",
};

/** One row of the catalog, already normalised out of its wire shape. */
export interface CatalogEntry {
  /** Command name without the leading slash. */
  name: string;
  description: string;
  /** Vietnamese category, when the catalog filed the row under one. */
  category?: string;
}

export interface MergedCatalog {
  commands: HermesCommand[];
  /** Names the baked list did not have. */
  added: string[];
  /** Baked names this install no longer offers. */
  dropped: string[];
  skillCount: number;
  warning: string;
}

/** `"…text… (usage: /name <args>)"` → the `<args>` part. */
const USAGE_RE = /\s*\(usage:\s*\/\S+\s*([^)]*)\)\s*$/;

/** A plausible slash command: `/name`, `/name-with-dashes`, `/skill:thing`. */
const NAME_RE = /^\/[A-Za-z0-9][\w:.-]*$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** `["/new", "desc"]` → `{name, description}`, or null when it is not that. */
function pairEntry(row: unknown, category?: string): CatalogEntry | null {
  if (!Array.isArray(row)) return null;
  const [rawName, rawDescription] = row;
  if (typeof rawName !== "string" || !NAME_RE.test(rawName)) return null;
  return {
    category,
    description: typeof rawDescription === "string" ? rawDescription : "",
    name: rawName.slice(1),
  };
}

/**
 * Normalise a `commands.catalog` payload into flat rows. Categorised rows win
 * over the flat `pairs` list, which repeats them without their category, and
 * anything named in `skills` is filed under Kỹ năng however it arrived.
 */
export function parseCommandCatalog(payload: unknown): CatalogEntry[] {
  const record = asRecord(payload);
  if (!record) return [];

  const byName = new Map<string, CatalogEntry>();

  const categories = Array.isArray(record.categories) ? record.categories : [];
  for (const group of categories) {
    const groupRecord = asRecord(group);
    if (!groupRecord) continue;
    const label =
      typeof groupRecord.name === "string" ? groupRecord.name : "";
    const category = CATEGORY_VI[label] ?? (label || undefined);
    const pairs = Array.isArray(groupRecord.pairs) ? groupRecord.pairs : [];
    for (const row of pairs) {
      const entry = pairEntry(row, category);
      if (entry && !byName.has(entry.name)) byName.set(entry.name, entry);
    }
  }

  const pairs = Array.isArray(record.pairs) ? record.pairs : [];
  for (const row of pairs) {
    const entry = pairEntry(row);
    if (entry && !byName.has(entry.name)) byName.set(entry.name, entry);
  }

  const skills = asRecord(record.skills);
  if (skills) {
    for (const key of Object.keys(skills)) {
      if (!NAME_RE.test(key)) continue;
      const name = key.slice(1);
      const existing = byName.get(name);
      if (existing) existing.category = CATEGORY_VI.Skills;
      else
        byName.set(name, {
          category: CATEGORY_VI.Skills,
          description: "",
          name,
        });
    }
  }

  return [...byName.values()];
}

/** Turn a catalog row the baked list never had into a palette entry. */
function commandFromCatalog(entry: CatalogEntry): HermesCommand {
  const usage = entry.description.match(USAGE_RE);
  const args = usage?.[1]?.trim();
  const plain = entry.description.replace(USAGE_RE, "").trim();
  return {
    args: args || undefined,
    category: entry.category ?? "Lệnh mới",
    description: entry.description || plain || "Lệnh của Hermes",
    name: entry.name,
    source: "gateway",
    vi: plain || "Lệnh mới của bản Hermes này — Dashboard chưa có mô tả tiếng Việt.",
  };
}

/**
 * Merge a `commands.catalog` payload over `baked`, keeping baked order (which
 * is everyday-commands-first) and appending whatever is new.
 */
export function mergeCommandCatalog(
  payload: unknown,
  baked: HermesCommand[] = HERMES_COMMANDS,
): MergedCatalog {
  const record = asRecord(payload);
  const entries = parseCommandCatalog(payload);
  const warning =
    record && typeof record.warning === "string" ? record.warning : "";
  const skillCount =
    record && typeof record.skill_count === "number" ? record.skill_count : 0;

  if (!entries.length) {
    return { added: [], commands: baked, dropped: [], skillCount, warning };
  }

  // Dropping only makes sense against a catalog that actually enumerated the
  // registry. `pairs` alone (no categories) means we are looking at something
  // partial, so every baked command is kept.
  const complete = Array.isArray(record?.categories) && record.categories.length > 0;

  const catalog = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
  const seen = new Set<string>();
  const commands: HermesCommand[] = [];
  const dropped: string[] = [];

  for (const command of baked) {
    const names = [command.name, ...(command.aliases ?? [])].map((name) =>
      name.toLowerCase(),
    );
    const hit = names.map((name) => catalog.get(name)).find(Boolean);
    for (const name of names) seen.add(name);
    if (!hit) {
      if (complete) {
        dropped.push(command.name);
        continue;
      }
      commands.push(command);
      continue;
    }
    // The registry's own wording can change between releases; the Vietnamese
    // note, the everyday flag and the terminal flag are ours and stay.
    commands.push(
      hit.description && hit.description !== command.description
        ? { ...command, description: hit.description }
        : command,
    );
  }

  const added: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry.name.toLowerCase())) continue;
    seen.add(entry.name.toLowerCase());
    commands.push(commandFromCatalog(entry));
    added.push(entry.name);
  }

  return { added, commands, dropped, skillCount, warning };
}
