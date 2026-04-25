import type { AgentPreviewResult } from "../agent/runtime";

export function resolveChatParticipantPrompt(
  prompt: string,
  command?: string,
  selectedText?: string,
): string {
  const trimmed = prompt.trim();
  const symbolSeed = trimmed || selectedText?.trim() || "current symbol";

  switch (command) {
    case "summary":
      return trimmed.length > 0
        ? `Summarize this project and focus on: ${trimmed}`
        : "What is this project about?";
    case "symbol":
      return `Analyze the symbol ${symbolSeed} with full context.`;
    case "dependencies":
      return `What does ${symbolSeed} depend on?`;
    case "impact":
      return `What is the change impact of ${symbolSeed}?`;
    case "memory":
      return trimmed.length > 0
        ? `Search project memory for: ${trimmed}`
        : "Search project memory for the most relevant recent decisions.";
     default:
       return trimmed;
   }
 }
 
 export function formatChatParticipantResult(result: AgentPreviewResult): string {
  const lines = [result.answer, "", "### Run details", `- Provider: ${result.providerKind ?? "none"}`, `- Plan source: ${result.plan.source}`];
 
   if (result.plan.kind === "tool") {
     lines.push(`- Tool: ${result.plan.toolName}`);
   }

  if ((result.plans?.length ?? 0) > 1) {
    lines.push(`- Tool sequence: ${result.plans?.filter((plan) => plan.kind === "tool").map((plan) => plan.toolName).join(" -> ")}`);
  }
 
   if (result.trace.length > 0) {
     lines.push("", "### Trace", ...result.trace.map((entry) => `- ${entry.step}. **${entry.phase}** — ${entry.message}`));
   }
 
   return lines.join("\n");
 }
