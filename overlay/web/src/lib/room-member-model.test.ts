import { describe, expect, it } from "vitest";

import {
  applyStateVi,
  buildModelUpdate,
  modelProblemVi,
  sameModelId,
  scopeWarningVi,
} from "./room-member-model";

/**
 * The risk here is not a cosmetic one. `PUT /api/profiles/{name}/model`
 * rewrites that profile's `config.yaml`, which changes the bot everywhere —
 * every other room and its own chats. A picker that sends a half-formed
 * payload, or lets the user believe the change is room-scoped, does real
 * damage to a running setup.
 */

describe("modelProblemVi", () => {
  it("refuses a model with no provider", () => {
    // The endpoint needs both halves: the provider decides the credentials
    // and base URL. A bare id is rejected server-side, so catch it here.
    expect(
      modelProblemVi({ id: "z-ai/glm-5.3-flash" }, "openai/gpt-5"),
    ).toContain("provider");
  });

  it("refuses an empty selection", () => {
    expect(modelProblemVi(null, "openai/gpt-5")).toBe("Chưa chọn model.");
  });

  it("refuses re-selecting the model already in use", () => {
    expect(
      modelProblemVi(
        { id: "openai/gpt-5", provider: "openai" },
        "openai/gpt-5",
      ),
    ).toBe("Đang dùng model này rồi.");
  });

  it("ignores case and padding when comparing to the current model", () => {
    expect(
      modelProblemVi(
        { id: "  OpenAI/GPT-5 ", provider: "openai" },
        "openai/gpt-5",
      ),
    ).toBe("Đang dùng model này rồi.");
  });

  it("passes a complete, different choice", () => {
    expect(
      modelProblemVi(
        { id: "z-ai/glm-5.3-flash", provider: "z-ai" },
        "openai/gpt-5",
      ),
    ).toBe("");
  });
});

describe("sameModelId", () => {
  it("treats case and surrounding space as the same model", () => {
    expect(sameModelId(" Anthropic/Claude ", "anthropic/claude")).toBe(true);
  });

  it("keeps genuinely different ids apart", () => {
    expect(sameModelId("openai/gpt-5", "openai/gpt-5-mini")).toBe(false);
  });
});

describe("scopeWarningVi", () => {
  it("names the other rooms the change will reach", () => {
    const text = scopeWarningVi("teo", 3);
    expect(text).toContain("@teo");
    expect(text).toContain("2 phòng khác");
    expect(text).toContain("nhắn riêng");
  });

  it("still warns when this is the only room", () => {
    // Even with one room the change is not room-scoped — it follows the
    // profile into its own chats.
    const text = scopeWarningVi("ti", 1);
    expect(text).not.toContain("0 phòng");
    expect(text).toContain("nhắn riêng");
  });

  it("says plainly that per-room models do not exist", () => {
    expect(scopeWarningVi("default", 2)).toContain("không có model riêng");
  });
});

describe("buildModelUpdate", () => {
  it("builds the payload the profiles endpoint requires", () => {
    expect(
      buildModelUpdate("teo", { id: " z-ai/glm-5.3-flash ", provider: " z-ai " }),
    ).toEqual({ model: "z-ai/glm-5.3-flash", name: "teo", provider: "z-ai" });
  });

  it("returns nothing rather than a payload the server would reject", () => {
    expect(buildModelUpdate("teo", { id: "some-model" })).toBeNull();
    expect(buildModelUpdate("", { id: "m", provider: "p" })).toBeNull();
    expect(buildModelUpdate("teo", null)).toBeNull();
  });
});

describe("applyStateVi", () => {
  it("does not claim the change is live yet", () => {
    // The running turn keeps its old model; the hot-swap happens at the start
    // of this member's next turn. Saying "done" would be a lie the user would
    // catch in the very next message.
    const text = applyStateVi("done", "z-ai/glm-5.3-flash");
    expect(text).toContain("lượt nói kế tiếp");
  });

  it("says nothing while idle", () => {
    expect(applyStateVi("idle", "x")).toBe("");
  });

  it("reports a failure instead of going quiet", () => {
    expect(applyStateVi("failed", "x")).toContain("Không đổi được");
  });
});
