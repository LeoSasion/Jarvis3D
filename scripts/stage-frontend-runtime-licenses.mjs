import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RECEIPT_FILE = "FRONTEND-RUNTIME-LICENSES.json";
const CLOSURE_ALGORITHM = "package-lock-v3-production-closure-v1";
const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const policyPath = join(scriptDirectory, "licenses", "frontend-runtime-policy.json");

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label} is unreadable: ${error.message}`);
  }
}

function canonicalLicense(path) {
  const text = readFileSync(path, "utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/g, "");
  return Buffer.from(`${text}\n`, "utf8");
}

function packageSlug(name) {
  return name
    .replace(/^@/, "")
    .replaceAll("/", "-")
    .replace(/[^A-Za-z0-9._-]/g, "-");
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, "en"));
}

function assertSameNames(actual, expected, label) {
  const left = sorted(actual);
  const right = sorted(expected);
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    fail(`${label} does not match the reviewed production dependency closure. Expected [${right.join(", ")}]; found [${left.join(", ")}].`);
  }
}

function assertObjectKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  assertSameNames(Object.keys(value), expectedKeys, `${label} fields`);
}

function parseArguments(argv) {
  const mode = argv[0] === "verify" ? "verify" : "stage";
  const start = argv[0] === "verify" || argv[0] === "stage" ? 1 : 0;
  const values = new Map();
  for (let index = start; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) {
      fail("Usage: stage-frontend-runtime-licenses.mjs [stage] --frontend-root <path> --destination <path>, or verify --frontend-root <path> --directory <path>.");
    }
    values.set(key, value);
  }
  if (mode === "verify") {
    if (values.size !== 2 || !values.has("--frontend-root") || !values.has("--directory")) {
      fail("Verify mode requires exactly --frontend-root and --directory.");
    }
    return {
      mode,
      frontendRoot: resolve(values.get("--frontend-root")),
      directory: resolve(values.get("--directory")),
    };
  }
  if (values.size !== 2 || !values.has("--frontend-root") || !values.has("--destination")) {
    fail("Stage mode requires exactly --frontend-root and --destination.");
  }
  return {
    mode,
    frontendRoot: resolve(values.get("--frontend-root")),
    destination: resolve(values.get("--destination")),
  };
}

function assertEmptyDestination(destination) {
  if (!existsSync(destination)) {
    mkdirSync(destination, { recursive: true });
    return;
  }
  const item = lstatSync(destination);
  if (!item.isDirectory() || item.isSymbolicLink()) fail(`License destination must be a real directory: ${destination}`);
  if (readdirSync(destination).length !== 0) fail(`License destination must be empty: ${destination}`);
}

function licenseOutputFile(policy) {
  const packagePath = policy.lockPath
    .slice("node_modules/".length)
    .replaceAll("/node_modules/", "--");
  return `${packageSlug(packagePath)}-${policy.version}-${policy.license}.txt`;
}

function loadReviewedPolicy() {
  const document = readJson(policyPath, "Frontend runtime license policy");
  assertObjectKeys(document, ["schemaVersion", "packages"], "Frontend runtime license policy");
  if (document.schemaVersion !== 1 || !Array.isArray(document.packages) || document.packages.length === 0) {
    fail("Frontend runtime license policy schema is invalid.");
  }

  const lockPaths = new Set();
  const outputFiles = new Set();
  for (const entry of document.packages) {
    assertObjectKeys(
      entry,
      ["integrity", "license", "lockPath", "name", "sha256", "source", "version"],
      "Frontend runtime license policy package",
    );
    if (
      typeof entry.lockPath !== "string"
      || !entry.lockPath.startsWith("node_modules/")
      || entry.lockPath.includes("\\")
      || entry.lockPath.split("/").includes("..")
      || typeof entry.name !== "string"
      || !entry.name
      || typeof entry.version !== "string"
      || !/^[0-9A-Za-z.+_-]+$/.test(entry.version)
      || typeof entry.license !== "string"
      || !/^[0-9A-Za-z.+_-]+$/.test(entry.license)
      || typeof entry.integrity !== "string"
      || !entry.integrity.startsWith("sha512-")
      || typeof entry.sha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(entry.sha256)
      || typeof entry.source !== "string"
      || !entry.source
    ) {
      fail(`Frontend runtime license policy contains unsafe metadata for ${entry.name ?? "<unknown>"}.`);
    }
    const sourceName = entry.source.startsWith("fallback:") ? entry.source.slice("fallback:".length) : entry.source;
    if (!sourceName || basename(sourceName) !== sourceName) {
      fail(`Frontend runtime license policy contains an unsafe source for ${entry.name}.`);
    }
    if (lockPaths.has(entry.lockPath)) fail(`Frontend runtime license policy duplicates ${entry.lockPath}.`);
    lockPaths.add(entry.lockPath);
    const file = licenseOutputFile(entry);
    if (outputFiles.has(file)) fail(`Frontend runtime license policy creates duplicate output ${file}.`);
    outputFiles.add(file);
  }

  return {
    packages: [...document.packages].sort((left, right) => left.lockPath.localeCompare(right.lockPath, "en")),
    sha256: sha256(readFileSync(policyPath)),
  };
}

function resolveDependencyLockPath(packages, parentLockPath, dependencyName) {
  let base = parentLockPath;
  while (true) {
    const candidate = `${base ? `${base}/` : ""}node_modules/${dependencyName}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const nestedIndex = base.lastIndexOf("/node_modules/");
    base = nestedIndex >= 0 ? base.slice(0, nestedIndex) : "";
  }
}

function collectProductionClosure(packageLock) {
  const packages = packageLock.packages;
  if (packageLock.lockfileVersion !== 3 || !packages || typeof packages !== "object" || !packages[""]) {
    fail("Frontend package-lock.json must use the reviewed lockfileVersion 3 packages format.");
  }

  const queue = [];
  const enqueue = (parentLockPath, dependencyName, optional, relation) => {
    const resolvedPath = resolveDependencyLockPath(packages, parentLockPath, dependencyName);
    if (!resolvedPath) {
      if (optional) return;
      fail(`Frontend package-lock.json cannot resolve required ${relation} ${dependencyName} from ${parentLockPath || "<root>"}.`);
    }
    queue.push(resolvedPath);
  };

  for (const dependencyName of Object.keys(packages[""].dependencies ?? {})) {
    enqueue("", dependencyName, false, "dependency");
  }
  for (const dependencyName of Object.keys(packages[""].optionalDependencies ?? {})) {
    enqueue("", dependencyName, true, "optional dependency");
  }

  const closure = new Set();
  while (queue.length > 0) {
    const lockPath = queue.shift();
    if (closure.has(lockPath)) continue;
    const entry = packages[lockPath];
    if (!entry || entry.dev === true) {
      fail(`Frontend production dependency ${lockPath} is missing or marked dev-only in package-lock.json.`);
    }
    closure.add(lockPath);

    for (const dependencyName of Object.keys(entry.dependencies ?? {})) {
      enqueue(lockPath, dependencyName, false, "dependency");
    }
    for (const dependencyName of Object.keys(entry.optionalDependencies ?? {})) {
      enqueue(lockPath, dependencyName, true, "optional dependency");
    }
    for (const dependencyName of Object.keys(entry.peerDependencies ?? {})) {
      const optional = entry.peerDependenciesMeta?.[dependencyName]?.optional === true;
      enqueue(lockPath, dependencyName, optional, "peer dependency");
    }
  }

  return sorted(closure);
}

function validateFrontendDependencyState(frontendRoot, reviewedPolicy, requireInstalledPackages) {
  const packageJsonPath = join(frontendRoot, "package.json");
  const packageLockPath = join(frontendRoot, "package-lock.json");
  const packageJson = readJson(packageJsonPath, "Frontend package.json");
  const packageLock = readJson(packageLockPath, "Frontend package-lock.json");
  const rootLockEntry = packageLock.packages?.[""];
  if (!rootLockEntry) fail("Frontend package-lock.json is missing its root package entry.");

  const dependencyNames = Object.keys(packageJson.dependencies ?? {});
  const lockRootDependencies = Object.keys(rootLockEntry.dependencies ?? {});
  assertSameNames(dependencyNames, lockRootDependencies, "Frontend root dependency names");
  for (const dependencyName of dependencyNames) {
    if (packageJson.dependencies[dependencyName] !== rootLockEntry.dependencies[dependencyName]) {
      fail(`Frontend root dependency spec for ${dependencyName} differs between package.json and package-lock.json.`);
    }
  }

  const optionalDependencyNames = Object.keys(packageJson.optionalDependencies ?? {});
  const lockRootOptionalDependencies = Object.keys(rootLockEntry.optionalDependencies ?? {});
  assertSameNames(
    optionalDependencyNames,
    lockRootOptionalDependencies,
    "Frontend root optional dependency names",
  );
  for (const dependencyName of optionalDependencyNames) {
    if (packageJson.optionalDependencies[dependencyName] !== rootLockEntry.optionalDependencies[dependencyName]) {
      fail(`Frontend root optional dependency spec for ${dependencyName} differs between package.json and package-lock.json.`);
    }
  }

  const closure = collectProductionClosure(packageLock);
  assertSameNames(
    closure,
    reviewedPolicy.packages.map((entry) => entry.lockPath),
    "Frontend production dependency closure",
  );

  for (const policy of reviewedPolicy.packages) {
    const lockEntry = packageLock.packages[policy.lockPath];
    if (
      lockEntry?.version !== policy.version
      || lockEntry?.license !== policy.license
      || lockEntry?.integrity !== policy.integrity
    ) {
      fail(`${policy.name} lock metadata no longer matches the reviewed version, license, and integrity receipt.`);
    }
    if (!requireInstalledPackages) continue;

    const packageRoot = join(frontendRoot, ...policy.lockPath.split("/"));
    if (!existsSync(packageRoot) || !lstatSync(packageRoot).isDirectory() || lstatSync(packageRoot).isSymbolicLink()) {
      fail(`${policy.name} installed package directory is missing or unsafe.`);
    }
    const metadataPath = join(packageRoot, "package.json");
    if (!existsSync(metadataPath) || !lstatSync(metadataPath).isFile() || lstatSync(metadataPath).isSymbolicLink()) {
      fail(`${policy.name} installed package metadata is missing or unsafe.`);
    }
    const installedMetadata = readJson(metadataPath, `${policy.name} package metadata`);
    if (
      installedMetadata.name !== policy.name
      || installedMetadata.version !== policy.version
      || installedMetadata.license !== policy.license
    ) {
      fail(`${policy.name} installed metadata does not match the reviewed name, version, and license.`);
    }
  }

  return {
    packageJsonSha256: sha256(readFileSync(packageJsonPath)),
    packageLockSha256: sha256(readFileSync(packageLockPath)),
  };
}

function resolveLicenseSource(policy, frontendRoot) {
  let path;
  let source;
  if (policy.source.startsWith("fallback:")) {
    const fallback = policy.source.slice("fallback:".length);
    path = join(scriptDirectory, "licenses", fallback);
    source = `scripts/licenses/${fallback}`;
  } else {
    path = join(frontendRoot, ...policy.lockPath.split("/"), policy.source);
    source = `${policy.lockPath}/${policy.source}`;
  }
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
    fail(`Reviewed license source is missing or unsafe for ${policy.name}: ${source}`);
  }
  return { path, source };
}

function expectedReceiptEntry(policy) {
  const source = policy.source.startsWith("fallback:")
    ? `scripts/licenses/${policy.source.slice("fallback:".length)}`
    : `${policy.lockPath}/${policy.source}`;
  return {
    lockPath: policy.lockPath,
    name: policy.name,
    version: policy.version,
    license: policy.license,
    integrity: policy.integrity,
    file: licenseOutputFile(policy),
    sha256: policy.sha256,
    source,
  };
}

function stage(frontendRoot, destination) {
  const reviewedPolicy = loadReviewedPolicy();
  const frontendState = validateFrontendDependencyState(frontendRoot, reviewedPolicy, true);
  assertEmptyDestination(destination);

  const written = [];
  try {
    const packages = [];
    for (const policy of reviewedPolicy.packages) {
      const source = resolveLicenseSource(policy, frontendRoot);
      const bytes = canonicalLicense(source.path);
      const hash = sha256(bytes);
      if (hash !== policy.sha256) {
        fail(`${policy.name} license SHA-256 changed. Expected ${policy.sha256}; found ${hash}.`);
      }
      const receiptEntry = expectedReceiptEntry(policy);
      if (receiptEntry.source !== source.source) fail(`Reviewed license source changed for ${policy.name}.`);
      writeFileSync(join(destination, receiptEntry.file), bytes, { flag: "wx" });
      written.push(receiptEntry.file);
      packages.push(receiptEntry);
    }

    const receipt = {
      schemaVersion: 2,
      closureAlgorithm: CLOSURE_ALGORITHM,
      policySha256: reviewedPolicy.sha256,
      packageJsonSha256: frontendState.packageJsonSha256,
      packageLockSha256: frontendState.packageLockSha256,
      packages,
    };
    writeFileSync(join(destination, RECEIPT_FILE), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
    written.push(RECEIPT_FILE);
    return verify(frontendRoot, destination);
  } catch (error) {
    for (const file of written) rmSync(join(destination, file), { force: true });
    throw error;
  }
}

function verify(frontendRoot, directory) {
  if (!existsSync(directory) || !lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
    fail(`Frontend runtime license directory is missing or unsafe: ${directory}`);
  }
  const reviewedPolicy = loadReviewedPolicy();
  const frontendState = validateFrontendDependencyState(frontendRoot, reviewedPolicy, false);
  const receiptPath = join(directory, RECEIPT_FILE);
  if (!existsSync(receiptPath) || !lstatSync(receiptPath).isFile() || lstatSync(receiptPath).isSymbolicLink()) {
    fail("Frontend runtime license receipt is missing or unsafe.");
  }
  const receipt = readJson(receiptPath, "Frontend runtime license receipt");
  assertObjectKeys(
    receipt,
    ["closureAlgorithm", "packageJsonSha256", "packageLockSha256", "packages", "policySha256", "schemaVersion"],
    "Frontend runtime license receipt",
  );
  if (receipt.schemaVersion !== 2 || receipt.closureAlgorithm !== CLOSURE_ALGORITHM || !Array.isArray(receipt.packages)) {
    fail("Frontend runtime license receipt schema is invalid.");
  }
  if (receipt.policySha256 !== reviewedPolicy.sha256) {
    fail("Frontend runtime license receipt is not bound to the reviewed policy.");
  }
  if (receipt.packageJsonSha256 !== frontendState.packageJsonSha256) {
    fail("Frontend runtime license receipt is not bound to the current package.json.");
  }
  if (receipt.packageLockSha256 !== frontendState.packageLockSha256) {
    fail("Frontend runtime license receipt is not bound to the current package-lock.json.");
  }

  assertSameNames(
    receipt.packages.map((entry) => entry?.lockPath),
    reviewedPolicy.packages.map((entry) => entry.lockPath),
    "Frontend runtime license receipt",
  );
  const receiptByLockPath = new Map(receipt.packages.map((entry) => [entry.lockPath, entry]));
  const expectedFiles = new Set([RECEIPT_FILE]);
  for (const policy of reviewedPolicy.packages) {
    const entry = receiptByLockPath.get(policy.lockPath);
    const expected = expectedReceiptEntry(policy);
    assertObjectKeys(
      entry,
      ["file", "integrity", "license", "lockPath", "name", "sha256", "source", "version"],
      `Frontend runtime license receipt package ${policy.name}`,
    );
    for (const key of Object.keys(expected)) {
      if (entry[key] !== expected[key]) {
        fail(`Frontend runtime license receipt ${key} is unreviewed for ${policy.name}.`);
      }
    }
    if (basename(entry.file) !== entry.file || expectedFiles.has(entry.file)) {
      fail(`Frontend runtime license receipt contains an unsafe or duplicate file for ${policy.name}.`);
    }
    expectedFiles.add(entry.file);
    const path = join(directory, entry.file);
    if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
      fail(`Frontend runtime license file is missing or unsafe: ${entry.file}`);
    }
    const actualHash = sha256(readFileSync(path));
    if (actualHash !== policy.sha256) {
      fail(`Frontend runtime license SHA-256 mismatch for ${policy.name}. Expected ${policy.sha256}; found ${actualHash}.`);
    }
  }
  assertSameNames(readdirSync(directory), expectedFiles, "Frontend runtime license directory contents");
  return {
    status: "verified",
    directory,
    packages: reviewedPolicy.packages.length,
    receipt: RECEIPT_FILE,
  };
}

try {
  const options = parseArguments(process.argv.slice(2));
  const result = options.mode === "verify"
    ? verify(options.frontendRoot, options.directory)
    : stage(options.frontendRoot, options.destination);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`frontend-runtime-licenses: ${error.message}\n`);
  process.exitCode = 1;
}
