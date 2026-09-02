import { Crown, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  AGENT_STATE_VI,
  agentDoingVi,
  agentLabelVi,
  elapsedVi,
  isFinished,
  liveAgents,
  roomSummaryVi,
  sortedAgents,
  type AgentRoom,
} from "@/lib/agent-room";

interface AgentTreeCardProps {
  room: AgentRoom;
  /** Focus one agent in the meeting-room panel. */
  onOpenAgent?: (agentId: string) => void;
}

/**
 * "Agents đang chạy" — the compact spawn tree for the right-hand control panel.
 *
 * Same state as the meeting-room panel, handed down from the chat rather than
 * fetched again: a second `delegation.status` poll from the sidebar would
 * double the traffic and let the two views disagree with each other.
 *
 * Deliberately smaller than the panel. It answers "who is running, on what,
 * for how long" and hands off to the panel for anything more, so a long list
 * of children cannot push the session info out of the sidebar.
 */
export function AgentTreeCard({ room, onOpenAgent }: AgentTreeCardProps) {
  const agents = sortedAgents(room);
  if (!agents.length) return null;
  const running = liveAgents(room).length;

  return (
    // Its own rail section, not a block appended inside the model section:
    // that section is `shrink-0`, so a growing tree pushed past the rail's
    // height and painted over the session list below it (v2.23.0).
    <section
      className="hermes-command-rail-section hermes-agent-tree"
      aria-label="Agents đang chạy"
    >
      <h3>
        <Users className="h-3.5 w-3.5" />
        Agents đang chạy
        <span>{roomSummaryVi(room)}</span>
      </h3>

      <div className="hermes-agent-tree-parent">
        <Crown className="h-3.5 w-3.5" />
        <strong>Hermes chính</strong>
        <em>{running ? "Đang điều phối" : "Đã xong phần giao việc"}</em>
      </div>

      <ul className="hermes-agent-tree-list">
        {agents.map((agent) => (
          <li key={agent.id} className={cn(`is-${agent.state}`)}>
            <button
              type="button"
              disabled={!onOpenAgent}
              onClick={() => onOpenAgent?.(agent.id)}
              title={agent.goal || undefined}
            >
              <span className="hermes-agent-tree-name">
                {agentLabelVi(agent)}
              </span>
              <span className="hermes-agent-tree-meta">
                <em>{AGENT_STATE_VI[agent.state]}</em>
                {agent.model ? <code>{agent.model}</code> : null}
                {elapsedVi(agent) ? <span>{elapsedVi(agent)}</span> : null}
              </span>
              {!isFinished(agent.state) ? (
                <span className="hermes-agent-tree-doing">
                  {agentDoingVi(agent)}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      {room.paused ? (
        <p className="hermes-agent-tree-note">
          Đang tạm ngưng giao việc cho agent mới.
        </p>
      ) : null}
    </section>
  );
}
