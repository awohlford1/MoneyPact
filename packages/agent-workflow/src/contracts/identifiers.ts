export const FRAMEWORK_ID_KINDS = [
  "assignment",
  "plan",
  "task",
  "execution",
  "action",
  "event",
  "manager_instance",
  "operation",
  "approval",
  "decision",
  "evidence",
] as const;

export type FrameworkIdKind = (typeof FRAMEWORK_ID_KINDS)[number];

export interface IdGenerator {
  generate(kind: FrameworkIdKind): string;
}
