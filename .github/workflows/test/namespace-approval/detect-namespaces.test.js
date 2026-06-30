import { readFile } from "fs/promises";
import yaml from "js-yaml";
import { describe, expect, it, vi } from "vitest";

// We can't easily test the default export (it depends on getChangedFiles and process.env),
// but we can test extractNamespaces and resolveLanguage by re-importing the module internals.
// Since they're not exported, we test them indirectly through tspconfig content.

// Mock readFile to return tspconfig content
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
  };
});

// Mock getChangedFiles — path must match the import in detect-namespaces.js
vi.mock("../../../shared/src/changed-files.js", () => ({
  getChangedFiles: vi.fn().mockResolvedValue([]),
}));

// Mock format validation
vi.mock("../../src/namespace-approval/validate-format.js", () => ({
  loadFormatRules: vi.fn().mockReturnValue(null),
  validateNamespaceFormat: vi.fn(),
}));

// Import after mocks
const { default: detectNamespaces } =
  await import("../../src/namespace-approval/detect-namespaces.js");
const { getChangedFiles } = await import("../../../shared/src/changed-files.js");

function createCore() {
  return {
    info: vi.fn(),
    warning: vi.fn(),
    setFailed: vi.fn(),
    setOutput: vi.fn(),
  };
}

function mgmtTspconfig() {
  return yaml.dump({
    linter: {
      extends: ["@azure-tools/typespec-azure-resource-manager/all"],
    },
    options: {
      "@azure-tools/typespec-csharp": {
        namespace: "Azure.ResourceManager.Compute",
      },
      "@azure-tools/typespec-java": {
        namespace: "com.azure.resourcemanager.compute",
      },
      "@azure-tools/typespec-python": {
        "package-details": { name: "azure-mgmt-compute" },
      },
      "@azure-tools/typespec-ts": {
        namespace: "@azure/arm-compute",
      },
      "@azure-tools/typespec-go": {
        module: "sdk/resourcemanager/compute/armcompute",
      },
    },
  });
}

function dataplaneTspconfig() {
  return yaml.dump({
    linter: {
      extends: ["@azure-tools/typespec-azure-core/all"],
    },
    options: {
      "@azure-tools/typespec-java": {
        namespace: "com.azure.messaging.eventgrid",
      },
      "@azure-tools/typespec-python": {
        "package-details": { name: "azure-eventgrid" },
      },
      "@azure-tools/typespec-ts": {
        namespace: "@azure/eventgrid",
      },
    },
  });
}

function rustTspconfig() {
  return yaml.dump({
    options: {
      "@azure-tools/typespec-rust": {
        "crate-name": "azure_storage_blobs",
      },
    },
  });
}

describe("detect-namespaces", () => {
  it("should detect management plane namespaces from path", async () => {
    const core = createCore();
    const file = "specification/compute/Compute.Management/tspconfig.yaml";
    getChangedFiles.mockResolvedValue([file]);
    readFile.mockResolvedValue(mgmtTspconfig());

    await detectNamespaces({
      context: {
        payload: { pull_request: { number: 42 }, action: "opened" },
      },
      core,
    });

    expect(core.setOutput).toHaveBeenCalledWith("results", "true");
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("should detect data plane from linter extends", async () => {
    const core = createCore();
    const file = "specification/eventgrid/EventGrid/tspconfig.yaml";
    getChangedFiles.mockResolvedValue([file]);
    readFile.mockResolvedValue(dataplaneTspconfig());

    await detectNamespaces({
      context: {
        payload: { pull_request: { number: 43 }, action: "opened" },
      },
      core,
    });

    expect(core.setOutput).toHaveBeenCalledWith("results", "true");
  });

  it("should extract rust crate-name", async () => {
    const core = createCore();
    const file = "specification/storage/Storage/tspconfig.yaml";
    getChangedFiles.mockResolvedValue([file]);
    readFile.mockResolvedValue(rustTspconfig());

    await detectNamespaces({
      context: {
        payload: { pull_request: { number: 44 }, action: "opened" },
      },
      core,
    });

    expect(core.setOutput).toHaveBeenCalledWith("results", "true");
  });

  it("should skip when no tspconfig.yaml changes detected", async () => {
    const core = createCore();
    getChangedFiles.mockResolvedValue(["specification/compute/readme.md"]);

    await detectNamespaces({
      context: {
        payload: { pull_request: { number: 45 }, action: "opened" },
      },
      core,
    });

    expect(core.info).toHaveBeenCalledWith("No tspconfig.yaml changes detected, skipping");
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it("should handle tspconfig with no emitter options", async () => {
    const core = createCore();
    const file = "specification/compute/Compute.Management/tspconfig.yaml";
    getChangedFiles.mockResolvedValue([file]);
    readFile.mockResolvedValue(yaml.dump({ linter: {} }));

    await detectNamespaces({
      context: {
        payload: { pull_request: { number: 46 }, action: "opened" },
      },
      core,
    });

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining("No emitter options found"));
  });
});
