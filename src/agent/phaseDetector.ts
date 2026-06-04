import type { WorkspacePhaseAssessment, WorkspaceProfile } from "../state/workspaceAnalysis";

function assessment(
  phase: WorkspacePhaseAssessment["phase"],
  confidence: number,
  reasons: string[],
): WorkspacePhaseAssessment {
  return {
    phase,
    confidence,
    reasons,
    updatedAt: new Date().toISOString(),
  };
}

export function detectWorkspacePhase(profile: WorkspaceProfile): WorkspacePhaseAssessment {
  const hasSource = profile.sourceDirectories.length > 0 || profile.repoType !== "docs-only";
  const hasTests = profile.testDirectories.length > 0
    || profile.testFrameworks.length > 0
    || profile.availableTestCommands.length > 0;
  const hasReleaseWorkflow = profile.likelyActions.some((action) => /\bpackage\b|\bpublish\b/i.test(action));

  if (profile.repoType === "docs-only" || (!hasSource && profile.hasInstructionDocs)) {
    return assessment("idea-spec", 0.92, [
      "Instruction or specification documents were detected.",
      "No source directories were detected yet.",
    ]);
  }

  if (hasSource && !hasTests && !profile.hasCi) {
    return assessment("scaffolding", 0.72, [
      "Source directories exist but test markers were not detected.",
      "CI workflow markers were not detected yet.",
    ]);
  }

  if (hasSource && !hasTests) {
    return assessment("implementation", 0.68, [
      "Source directories exist.",
      "Test frameworks or test commands have not been detected yet.",
    ]);
  }

  if (hasSource && hasTests && profile.hasCi && hasReleaseWorkflow && profile.hasInstructionDocs) {
    return assessment("maintenance", 0.76, [
      "Tests, CI, and release/package workflows are present.",
      "Documentation and operating instructions are already established.",
    ]);
  }

  if (hasSource && hasTests && profile.hasCi) {
    return assessment("hardening", 0.82, [
      "Tests and CI workflow markers were detected.",
      "The workspace has enough structure to prioritize validation and release readiness.",
    ]);
  }

  if (hasSource && hasTests) {
    return assessment("testing", 0.79, [
      "Test frameworks or test commands were detected.",
      "Source directories are present, so validation loops are now a primary concern.",
    ]);
  }

  return assessment("implementation", 0.55, [
    "A partial workspace structure was detected.",
    "The workspace does not yet clearly signal a later lifecycle phase.",
  ]);
}
