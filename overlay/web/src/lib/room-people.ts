/**
 * Turning a room member into someone a person can recognise on screen.
 *
 * Hermes stores a member as `{member_id, profile, handle}` and nothing else —
 * no avatar, no job title, no online flag. A chat UI needs a face and a line
 * of context for each participant, and there are honest ways to get both:
 *
 * - **The face** is generated: initials over a colour derived from the handle,
 *   stable for the life of that handle. Not a photograph of a person who does
 *   not exist.
 * - **The subtitle** is the profile's own `description`, which the user wrote
 *   when they created the profile. Where a mock-up would put "Nghiên cứu" or
 *   "Kỹ thuật", this puts whatever the profile actually says about itself, and
 *   nothing at all when it says nothing. Hermes assigns rooms no roles.
 * - **The model** is the profile's configured model, joined from `/api/profiles`.
 *
 * What is deliberately NOT derived: a per-member "online / idle" light. The
 * driver reports `working`, `blocked` and task counts for the whole room; there
 * is no per-member liveness anywhere in `driver_status`. What can be known is
 * when someone last spoke, so that is what the panel shows.
 */

import type { RoomEvent, RoomMember } from "./hermes-rooms";

export interface RoomPerson {
  id: string;
  handle: string;
  profile: string;
  /** The profile's own description, when it has one. */
  about: string;
  /** The model this profile runs on, when the profiles API knew. */
  model: string;
  /** Two letters for the generated avatar. */
  initials: string;
  /** A stable hue, 0–359, derived from the handle. */
  hue: number;
  /** Round index of this member's most recent message, or null. */
  lastRound: number | null;
  /** Epoch seconds of their last message, or null. */
  lastSpokeAt: number | null;
}

/** A profile row, narrowed to what this module needs. */
export interface ProfileLike {
  name: string;
  description?: string;
  model?: string | null;
  display_name?: string;
}

/**
 * A stable hue per handle.
 *
 * Deterministic so a member keeps the same colour across reloads — a face that
 * changes colour every visit is worse than no colour.
 */
export function hueFor(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360000;
  }
  return hash % 360;
}

/** One or two letters, taken from word starts so "Trợ lý Kế toán" reads TK. */
export function initialsFor(name: string): string {
  const words = name
    .trim()
    .split(/[\s._:-]+/)
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Join room members with profile detail and what the log says they did. */
export function buildPeople(
  members: RoomMember[],
  profiles: ProfileLike[],
  events: RoomEvent[],
): RoomPerson[] {
  return members.map((member) => {
    const profile = profiles.find(
      (entry) => entry.name === (member.profile || member.id),
    );

    let lastRound: number | null = null;
    let lastSpokeAt: number | null = null;
    for (const event of events) {
      if (event.kind !== "message.member" || event.memberId !== member.id) continue;
      if (lastSpokeAt === null || (event.createdAt ?? 0) >= lastSpokeAt) {
        lastRound = event.roundIndex;
        lastSpokeAt = event.createdAt;
      }
    }

    return {
      about: (profile?.description ?? "").trim(),
      handle: member.label,
      hue: hueFor(member.label || member.id),
      id: member.id,
      initials: initialsFor(profile?.display_name || member.label || member.id),
      lastRound,
      lastSpokeAt,
      model: (profile?.model ?? "").trim(),
      profile: member.profile || member.id,
    };
  });
}

/**
 * What this member has done in the discussion so far, in Vietnamese.
 *
 * Never claims a member is "online" or "idle": the runtime reports no such
 * thing per member. It reports what the log shows.
 */
export function personActivityVi(person: RoomPerson): string {
  if (person.lastRound !== null) return `đã nói ở vòng ${person.lastRound + 1}`;
  return "chưa phát biểu";
}

/** The avatar's background, as an inline style value. */
export function avatarStyle(person: RoomPerson): {
  background: string;
  color: string;
} {
  return {
    background: `hsl(${person.hue} 62% 88%)`,
    color: `hsl(${person.hue} 55% 28%)`,
  };
}
