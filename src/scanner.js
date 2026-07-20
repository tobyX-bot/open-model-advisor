import { extractCandidates } from "./scanner/extractors.js";
import { normalizeSetupText } from "./scanner/normalize.js";
import { resolveCandidates } from "./scanner/resolve.js";

export function scanSetupText(text) {
  const document = normalizeSetupText(String(text || ""));
  const result = resolveCandidates(document, extractCandidates(document));
  if (!document.truncated) return result;

  const truncationIssue = {
    code: "input.truncated",
    severity: "review",
    fields: [],
    messageKey: "input.truncated"
  };
  return {
    ...result,
    issues: [...result.issues, truncationIssue],
    warnings: [...new Set([...result.warnings, truncationIssue.messageKey])]
  };
}
