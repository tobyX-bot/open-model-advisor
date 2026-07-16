import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(ROOT, "fixtures", "computer_setups_200_v1_1.json");
const CHECKER_PATH = path.join(ROOT, "check-dataset.mjs");
const GENERATOR_PATH = path.join(ROOT, "generate-dataset.mjs");
const FROZEN_SHA256 = "54fe97fdd3e8b742000bd9df4ec79c586e0e16eeaa07f3c61ac99aebefce02b7";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const frozenBytes = fs.readFileSync(FIXTURE_PATH);
if (sha256(frozenBytes) !== FROZEN_SHA256) throw new Error("Committed V1.1 fixture is not at the frozen SHA-256");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "model-digger-freeze-"));
const temporaryFixture = path.join(temporaryDirectory, "computer_setups_200_v1_1.json");
const redirectedOutput = path.join(temporaryDirectory, "generator-output.json");
const driftedGeneratorPath = path.join(ROOT, `.test-drift-generator-${process.pid}.mjs`);

function runDatasetChecker(bytes) {
  fs.writeFileSync(temporaryFixture, bytes);
  return spawnSync(process.execPath, [CHECKER_PATH, temporaryFixture], { encoding: "utf8" });
}

try {
  const baseline = runDatasetChecker(frozenBytes);
  if (baseline.status !== 0) throw new Error(`Dataset checker rejected frozen V1.1:\n${baseline.stderr || baseline.stdout}`);

  const mutationFailures = [];
  const byteMutation = Buffer.concat([frozenBytes, Buffer.from("\n")]);
  if (runDatasetChecker(byteMutation).status === 0) mutationFailures.push("byte mutation with unchanged metadata");

  const semanticMutation = JSON.parse(frozenBytes.toString("utf8"));
  semanticMutation.records[0].parserExpected.fields.ram += 1;
  const semanticBytes = Buffer.from(`${JSON.stringify(semanticMutation, null, 2)}\n`);
  if (runDatasetChecker(semanticBytes).status === 0) mutationFailures.push("semantic mutation with unchanged metadata");

  const generatorSource = fs.readFileSync(GENERATOR_PATH, "utf8");
  const outputDeclaration = "const OUTPUT = path.join(ROOT, \"fixtures\", \"computer_setups_200_v1_1.json\");";
  const derivationMarker = "derivative.records.forEach(correctOracle);";
  let driftedSource = generatorSource.replace(outputDeclaration, `const OUTPUT = ${JSON.stringify(redirectedOutput)};`);
  driftedSource = driftedSource.replace(
    derivationMarker,
    `${derivationMarker}\nderivative.metadata.erratum.absentGpuEvidence.description += \" drift\";`
  );
  if (driftedSource === generatorSource || !driftedSource.includes("description += \" drift\"")) {
    throw new Error("Could not construct drifted generator test copy");
  }

  const sentinel = Buffer.from("frozen-output-sentinel\n");
  fs.writeFileSync(redirectedOutput, sentinel);
  fs.writeFileSync(driftedGeneratorPath, driftedSource);
  const driftedRun = spawnSync(process.execPath, [driftedGeneratorPath], { encoding: "utf8" });
  const generatorBlocked = driftedRun.status !== 0;
  const outputPreserved = fs.readFileSync(redirectedOutput).equals(sentinel);
  const frozenPreserved = sha256(fs.readFileSync(FIXTURE_PATH)) === FROZEN_SHA256;

  if (mutationFailures.length || !generatorBlocked || !outputPreserved || !frozenPreserved) {
    console.error("Frozen fixture tests failed:");
    mutationFailures.forEach((failure) => console.error(`- Dataset checker accepted ${failure}`));
    if (!generatorBlocked) console.error("- Drifted generator completed successfully");
    if (!outputPreserved) console.error("- Drifted generator overwrote its existing output");
    if (!frozenPreserved) console.error("- Frozen V1.1 fixture hash changed");
    process.exitCode = 1;
  } else {
    console.log("PASS frozen fixture tests: byte and semantic mutations rejected; drifted generation blocked before write.");
  }
} finally {
  fs.rmSync(driftedGeneratorPath, { force: true });
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
