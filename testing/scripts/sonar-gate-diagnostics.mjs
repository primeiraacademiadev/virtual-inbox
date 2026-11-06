// Diagnostic-only reader of SonarQube Cloud PR quality gate failures.
// Uses the CI secret only to authenticate requests; never prints it or code snippets.
// This tool does not change the gate, project settings, or issue statuses.
const projectKey = "primeiraacademiadev_virtual-inbox";
const pullRequest = process.env.PR_NUMBER;
const token = process.env.SONAR_TOKEN;
if (!token || !/^\d+$/.test(pullRequest ?? "")) {
  console.error("SonarCloud diagnostic unavailable: missing token or pull request number");
  process.exitCode = 1;
} else {
  const authorization = "Basic " + Buffer.from(token + ":").toString("base64");
  async function read(endpoint) {
    const url = new URL(endpoint, "https://sonarcloud.io");
    const response = await fetch(url, {
      headers: { Authorization: authorization, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error("SonarCloud API returned HTTP " + response.status);
    return response.json();
  }
  try {
    const params = new URLSearchParams({ projectKey, pullRequest });
    const gate = await read("/api/qualitygates/project_status?" + params);
    console.log("SonarCloud gate:", gate.projectStatus?.status);
    for (const condition of gate.projectStatus?.conditions ?? []) {
      if (condition.status !== "OK") {
        console.log("Failed condition", JSON.stringify({
          metric: condition.metricKey, actual: condition.actualValue,
          threshold: condition.errorThreshold,
        }));
      }
    }
    const issueQuery = new URLSearchParams({
      componentKeys: projectKey, pullRequest,
      issueStatuses: "OPEN,CONFIRMED", inNewCodePeriod: "true", ps: "100",
    });
    const issues = await read("/api/issues/search?" + issueQuery);
    console.log("Open new-code issues", issues.total ?? 0);
    for (const issue of (issues.issues ?? []).slice(0, 30)) {
      const impacts = (issue.impacts ?? []).map(({ softwareQuality, severity }) =>
        softwareQuality + ":" + severity);
      if (impacts.some(impact => impact.startsWith("SECURITY:")) ||
        issue.type === "VULNERABILITY") {
        console.log("Security issue", JSON.stringify({
          rule: issue.rule, component: issue.component?.replace(projectKey + ":", ""),
          line: issue.line, severity: issue.severity, impacts,
          message: issue.message,
        }));
      }
    }
  } catch (error) {
    // Gate failure is authoritative even if the optional diagnostic is unavailable.
    console.error("SonarCloud diagnostic fetch failed:", error.message);
    process.exitCode = 1;
  }
}
