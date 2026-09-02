import { describe, expect, it } from "vitest";

import {
  avatarStyle,
  buildPeople,
  hueFor,
  initialsFor,
  personActivityVi,
  type ProfileLike,
} from "./room-people";
import { parseRoomEvent, type RoomEvent, type RoomMember } from "./hermes-rooms";

/**
 * The mock-up this panel is modelled on showed job titles and green
 * "online" dots. Hermes stores neither, so these tests pin what replaces
 * them: the profile's own words, and what the log actually recorded.
 */

const members: RoomMember[] = [
  { id: "default", label: "Yumiko", profile: "default" },
  { id: "teo", label: "Teo", profile: "teo" },
];

const profiles: ProfileLike[] = [
  { description: "Điều phối cả nhà", model: "hermes-3", name: "default" },
  { description: "", model: "gemini-2.5", name: "teo" },
];

function memberMessage(memberId: string, round: number, at: number): RoomEvent {
  return parseRoomEvent({
    actor: { id: memberId, kind: "member" },
    created_at: at,
    event_id: `ev-${at}`,
    kind: "message.member",
    payload: { member_id: memberId, round_index: round, text: "…" },
    room_id: "room-1",
    seq: at,
  })!;
}

describe("initialsFor", () => {
  it("takes the start of each word", () => {
    expect(initialsFor("Trợ lý Kế toán")).toBe("TL");
    expect(initialsFor("Yumiko")).toBe("YU");
    expect(initialsFor("ops-backup")).toBe("OB");
  });

  it("never returns an empty label", () => {
    expect(initialsFor("   ")).toBe("?");
  });
});

describe("hueFor", () => {
  it("is stable, so a face does not change colour between visits", () => {
    expect(hueFor("Yumiko")).toBe(hueFor("Yumiko"));
    expect(hueFor("Yumiko")).toBeGreaterThanOrEqual(0);
    expect(hueFor("Yumiko")).toBeLessThan(360);
  });

  it("separates different handles", () => {
    expect(hueFor("Yumiko")).not.toBe(hueFor("Teo"));
  });
});

describe("buildPeople", () => {
  it("uses the profile's own description rather than an invented role", () => {
    // Hermes assigns room members no roles at all; a made-up "Nghiên cứu"
    // would be a job title the user never gave anyone.
    const people = buildPeople(members, profiles, []);
    expect(people[0].about).toBe("Điều phối cả nhà");
    expect(people[1].about).toBe("");
  });

  it("joins the model from the profiles API", () => {
    expect(buildPeople(members, profiles, [])[1].model).toBe("gemini-2.5");
  });

  it("survives a member whose profile is not in the list", () => {
    const people = buildPeople(
      [{ id: "ghost", label: "Ghost", profile: "ghost" }],
      profiles,
      [],
    );
    expect(people[0]).toMatchObject({ about: "", model: "" });
  });

  it("reports the round each member last spoke in", () => {
    const people = buildPeople(members, profiles, [
      memberMessage("teo", 0, 100),
      memberMessage("teo", 1, 200),
    ]);
    expect(people[1].lastRound).toBe(1);
    expect(people[1].lastSpokeAt).toBe(200);
    // Nobody claims the other member is "idle" — only that they have not spoken.
    expect(people[0].lastRound).toBeNull();
  });

  it("ignores events belonging to other members", () => {
    const people = buildPeople(members, profiles, [memberMessage("teo", 2, 300)]);
    expect(people[0].lastRound).toBeNull();
  });
});

describe("personActivityVi", () => {
  it("says what the log shows, never an online state", () => {
    const [yumiko, teo] = buildPeople(members, profiles, [
      memberMessage("teo", 1, 100),
    ]);
    expect(personActivityVi(teo)).toBe("đã nói ở vòng 2");
    expect(personActivityVi(yumiko)).toBe("chưa phát biểu");
  });
});

describe("avatarStyle", () => {
  it("gives a readable pair, not a photo of a person who does not exist", () => {
    const style = avatarStyle(buildPeople(members, profiles, [])[0]);
    expect(style.background).toContain("hsl(");
    expect(style.color).toContain("hsl(");
  });
});
