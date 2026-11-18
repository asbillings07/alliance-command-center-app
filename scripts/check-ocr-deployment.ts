import { checkOcrDeploymentIsolation } from "../app/src/lib/ocr/deploymentIsolation";

const problems = checkOcrDeploymentIsolation(process.env);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log("OCR database configuration preflight passed. No database connection was opened.");
}
