import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(ROOT, "fixtures", "computer_setups_200_v1_1.json");
const CHECKER_PATH = path.join(ROOT, "check-fixture-semantics.mjs");
const EXPECTED_ADVERSARIAL_KINDS = new Set([
  "contradiction-a",
  "contradiction-b",
  "core-ultra",
  "omitted-memory",
  "unknown-cpu",
  "unknown-gpu"
]);

const source = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

function recordFor(dataset, kind, id = null) {
  const record = id
    ? dataset.records.find((candidate) => candidate.id === id)
    : dataset.records.find((candidate) => candidate.adversarialKind === kind);
  if (!record || record.adversarialKind !== kind) throw new Error(`Missing ${kind} mutation record`);
  return record;
}

const mutationCases = [
  {
    name: "contradiction RAM cannot become missing",
    kind: "contradiction-a",
    mutate(dataset) {
      const expected = recordFor(dataset, this.kind).parserExpected;
      expected.fieldStatuses.ram = "missing";
      expected.expectedIssueCodes.ram = "missing.ram";
    }
  },
  {
    name: "contradiction VRAM cannot become missing",
    kind: "contradiction-b",
    mutate(dataset) {
      const expected = recordFor(dataset, this.kind).parserExpected;
      expected.fieldStatuses.vram = "missing";
      expected.expectedIssueCodes.vram = "missing.vram";
    }
  },
  {
    name: "labeled unknown CPU cannot become conflict",
    kind: "unknown-cpu",
    mutate(dataset) {
      const expected = recordFor(dataset, this.kind).parserExpected;
      expected.fieldStatuses.cpuModel = "conflict";
      expected.expectedIssueCodes.cpuModel = "conflict.ram";
    }
  },
  {
    name: "labeled unknown GPU model cannot become missing",
    kind: "unknown-gpu",
    mutate(dataset) {
      const expected = recordFor(dataset, this.kind).parserExpected;
      expected.fieldStatuses.gpuModel = "missing";
      expected.expectedIssueCodes.gpuModel = "missing.gpuModel";
    }
  },
  {
    name: "omitted RAM cannot become conflict",
    kind: "omitted-memory",
    mutate(dataset) {
      const expected = recordFor(dataset, this.kind, "user-152").parserExpected;
      expected.fieldStatuses.ram = "conflict";
      expected.expectedIssueCodes.ram = "conflict.ram";
    }
  },
  {
    name: "absent GPU model cannot become unknown",
    kind: "omitted-memory",
    mutate(dataset) {
      const expected = recordFor(dataset, this.kind, "user-040").parserExpected;
      expected.fieldStatuses.gpuModel = "unknown";
      expected.expectedIssueCodes.gpuModel = "unknown.gpuModel";
    }
  },
  {
    name: "Core Ultra cannot gain an ambiguous conflict field",
    kind: "core-ultra",
    mutate(dataset) {
      const expected = recordFor(dataset, this.kind).parserExpected;
      delete expected.fields.ram;
      delete expected.sourceEvidence.ram;
      expected.ambiguousFields.push("ram");
      expected.fieldStatuses.ram = "conflict";
      expected.expectedIssueCodes.ram = "conflict.ram";
    }
  }
];

const presentKinds = new Set(source.records.map((record) => record.adversarialKind).filter(Boolean));
const coveredKinds = new Set(mutationCases.map((testCase) => testCase.kind));
for (const kind of EXPECTED_ADVERSARIAL_KINDS) {
  if (!presentKinds.has(kind)) throw new Error(`Expected adversarial kind is absent from V1.1: ${kind}`);
  if (!coveredKinds.has(kind)) throw new Error(`Mutation suite does not cover adversarial kind: ${kind}`);
}
for (const kind of presentKinds) {
  if (!EXPECTED_ADVERSARIAL_KINDS.has(kind)) throw new Error(`Unrecognized adversarial kind lacks mutation coverage: ${kind}`);
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "model-digger-semantics-"));
const temporaryFixture = path.join(temporaryDirectory, "computer_setups_200_v1_1.json");

function runChecker(dataset) {
  fs.writeFileSync(temporaryFixture, `${JSON.stringify(dataset, null, 2)}\n`);
  return spawnSync(process.execPath, [CHECKER_PATH, temporaryFixture], { encoding: "utf8" });
}

try {
  const baseline = runChecker(source);
  if (baseline.status !== 0) {
    throw new Error(`Semantic checker rejected the unmodified fixture:\n${baseline.stderr || baseline.stdout}`);
  }

  const failures = [];
  mutationCases.forEach((testCase) => {
    const mutated = structuredClone(source);
    testCase.mutate(mutated);
    const result = runChecker(mutated);
    if (result.status === 0) failures.push(testCase.name);
  });

  if (failures.length) {
    console.error(`Fixture semantic mutation tests failed: ${failures.length} invalid mutation(s) were accepted.`);
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
  } else {
    console.log(`PASS fixture semantic mutation tests: ${mutationCases.length} invalid mutations rejected across ${coveredKinds.size} adversarial kinds.`);
  }
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
