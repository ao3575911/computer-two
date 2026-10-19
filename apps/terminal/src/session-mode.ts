export type SessionMode = "shell" | "intent";

export function sessionModeLabel(mode: SessionMode): string {
  switch (mode) {
    case "shell":
      return "Shell mode";
    case "intent":
      return "Intent mode";
    default: {
      const unreachable: never = mode;
      throw new Error(`unhandled mode ${String(unreachable)}`);
    }
  }
}
