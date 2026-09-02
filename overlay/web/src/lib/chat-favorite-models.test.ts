import { describe, expect, it } from "vitest";

import {
  addFavorite,
  FAVORITE_MODELS_LIMIT,
  isFavorite,
  modelShortLabel,
  normalizeModelId,
  parseFavorites,
  removeFavorite,
  searchModelOptions,
  serializeFavorites,
  type FavoriteModel,
} from "./chat-favorite-models";

describe("normalizeModelId", () => {
  it("takes what people actually paste", () => {
    expect(normalizeModelId("  z-ai/glm-5.3-flash  ")).toBe("z-ai/glm-5.3-flash");
    expect(normalizeModelId("/model z-ai/glm-5.3-flash")).toBe(
      "z-ai/glm-5.3-flash",
    );
    expect(normalizeModelId("/MODEL  gpt-5")).toBe("gpt-5");
    expect(normalizeModelId('"claude-opus-5"')).toBe("claude-opus-5");
  });

  it("is empty for nothing worth storing", () => {
    expect(normalizeModelId("   ")).toBe("");
    expect(normalizeModelId("/model ")).toBe("");
  });
});

describe("modelShortLabel", () => {
  it("keeps the part that tells models apart", () => {
    expect(modelShortLabel("openrouter/z-ai/glm-5.3-flash")).toBe(
      "glm-5.3-flash",
    );
    expect(modelShortLabel("gpt-5")).toBe("gpt-5");
  });
});

describe("addFavorite", () => {
  it("puts the newest first", () => {
    const list = addFavorite(addFavorite([], "a"), "b");
    expect(list.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("moves a re-added model up instead of duplicating it", () => {
    const list = addFavorite(addFavorite(addFavorite([], "a"), "b"), "a");
    expect(list.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("treats a differently-cased id as the same model", () => {
    const list = addFavorite(addFavorite([], "GPT-5"), "gpt-5");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("gpt-5");
  });

  it("normalises on the way in", () => {
    expect(addFavorite([], "  /model  gpt-5 ")[0].id).toBe("gpt-5");
  });

  it("refuses an entry with nothing in it", () => {
    const list: FavoriteModel[] = [{ id: "a" }];
    expect(addFavorite(list, "   ")).toBe(list);
  });

  it("keeps the provider when one was given, and drops an empty one", () => {
    expect(addFavorite([], { id: "gpt-5", provider: "openai" })[0]).toEqual({
      id: "gpt-5",
      provider: "openai",
    });
    expect(addFavorite([], { id: "gpt-5", provider: "" })[0]).toEqual({
      id: "gpt-5",
    });
  });

  it("caps the bar so it stays a quick switcher", () => {
    let list: FavoriteModel[] = [];
    for (let i = 0; i < FAVORITE_MODELS_LIMIT + 5; i++) {
      list = addFavorite(list, `model-${i}`);
    }
    expect(list).toHaveLength(FAVORITE_MODELS_LIMIT);
    expect(list[0].id).toBe(`model-${FAVORITE_MODELS_LIMIT + 4}`);
  });
});

describe("removeFavorite / isFavorite", () => {
  const list: FavoriteModel[] = [{ id: "a/one" }, { id: "b/two" }];

  it("removes by id, case-insensitively", () => {
    expect(removeFavorite(list, "A/ONE")).toEqual([{ id: "b/two" }]);
  });

  it("leaves the list alone when nothing matches", () => {
    expect(removeFavorite(list, "c/three")).toEqual(list);
  });

  it("answers membership the same way the add box has to", () => {
    expect(isFavorite(list, " /model A/One ")).toBe(true);
    expect(isFavorite(list, "c/three")).toBe(false);
  });
});

describe("parseFavorites", () => {
  it("round-trips what it serialises", () => {
    const list: FavoriteModel[] = [
      { id: "gpt-5", provider: "openai" },
      { id: "z-ai/glm-5.3-flash" },
    ];
    expect(parseFavorites(serializeFavorites(list))).toEqual(list);
  });

  it("accepts a hand-written array of plain ids", () => {
    expect(parseFavorites('["gpt-5", "claude-opus-5"]')).toEqual([
      { id: "gpt-5" },
      { id: "claude-opus-5" },
    ]);
  });

  it("returns an empty list rather than throwing on junk", () => {
    expect(parseFavorites(null)).toEqual([]);
    expect(parseFavorites("")).toEqual([]);
    expect(parseFavorites("{not json")).toEqual([]);
    expect(parseFavorites('{"id":"gpt-5"}')).toEqual([]);
  });

  it("skips rows that carry no usable id", () => {
    expect(parseFavorites('[{"id":""}, 7, null, {"id":"gpt-5"}]')).toEqual([
      { id: "gpt-5" },
    ]);
  });

  it("drops duplicates that a hand edit left behind", () => {
    expect(parseFavorites('["gpt-5", "GPT-5"]')).toEqual([{ id: "gpt-5" }]);
  });

  it("honours the cap even from storage", () => {
    const raw = JSON.stringify(
      Array.from({ length: 40 }, (_, i) => `model-${i}`),
    );
    expect(parseFavorites(raw)).toHaveLength(FAVORITE_MODELS_LIMIT);
  });
});

describe("searchModelOptions", () => {
  const options: FavoriteModel[] = [
    { id: "openai/gpt-5", provider: "openai" },
    { id: "z-ai/glm-5.3-flash", provider: "openrouter" },
    { id: "anthropic/claude-opus-5", provider: "anthropic" },
  ];

  it("returns everything, capped, for an empty query", () => {
    expect(searchModelOptions("", options)).toHaveLength(3);
    expect(searchModelOptions("  ", options, 2)).toHaveLength(2);
  });

  it("ranks a match on the short name above one buried in the path", () => {
    expect(searchModelOptions("glm", options)[0].id).toBe("z-ai/glm-5.3-flash");
  });

  it("finds models by provider too", () => {
    expect(searchModelOptions("openrouter", options)).toEqual([
      { id: "z-ai/glm-5.3-flash", provider: "openrouter" },
    ]);
  });

  it("finds nothing when nothing matches", () => {
    expect(searchModelOptions("llama", options)).toEqual([]);
  });
});
