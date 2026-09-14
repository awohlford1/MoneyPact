export const ACTOR_TYPES = [
  "executive",
  "manager",
  "specialist",
  "runtime",
  "external_system",
] as const;

export type ActorType = (typeof ACTOR_TYPES)[number];

export interface ActorRef {
  actorId: string;
  actorType: ActorType;
  displayName?: string;
  provider?: string;
}
