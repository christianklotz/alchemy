import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { destroy } from "../../src/destroy.ts";
import { ArtifactRegistry } from "../../src/google-cloud/artifact-registry.ts";
import { BRANCH_PREFIX } from "../util.ts";

import "../../src/test/vitest.ts";

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

describe.skipIf(!process.env.ALL_TESTS)(
  "Google Cloud Artifact Registry",
  () => {
    const location =
      process.env.GOOGLE_CLOUD_ZONE?.split("-").slice(0, 2).join("-") ??
      "us-central1";

    test("create, update, and delete repository", async (scope) => {
      let registry: ArtifactRegistry | undefined;
      const testId = `${BRANCH_PREFIX}-alchemy-test-repo`;

      try {
        // Create a Docker repository
        registry = await ArtifactRegistry(testId, {
          name: testId,
          location,
          format: "docker",
          description: "Test repository",
          labels: {
            environment: "test",
          },
        });

        expect(registry.name).toEqual(testId);
        expect(registry.location).toEqual(location);
        expect(registry.format).toEqual("docker");
        expect(registry.description).toEqual("Test repository");
        expect(registry.labels).toEqual({ environment: "test" });
        expect(registry.host).toContain(`${location}-docker.pkg.dev`);
        expect(registry.host).toContain(testId);

        // Update the repository (mutable properties)
        registry = await ArtifactRegistry(testId, {
          name: testId,
          location,
          format: "docker",
          description: "Updated test repository",
          labels: {
            environment: "test",
            updated: "true",
          },
        });

        expect(registry.description).toEqual("Updated test repository");
        expect(registry.labels).toEqual({
          environment: "test",
          updated: "true",
        });
      } finally {
        await destroy(scope);

        // Verify repository was deleted
        if (registry) {
          await assertRepositoryDeleted(registry);
        }
      }
    });
  },
);

async function assertRepositoryDeleted(registry: ArtifactRegistry) {
  const { ArtifactRegistryClient } =
    await import("@google-cloud/artifact-registry");
  const client = new ArtifactRegistryClient();

  try {
    await client.getRepository({
      name: registry.resourceName,
    });
    throw new Error(`Repository ${registry.name} should have been deleted`);
  } catch (error: unknown) {
    // Expected: NOT_FOUND error (code 5)
    if (error && typeof error === "object" && "code" in error) {
      expect((error as { code: number }).code).toEqual(5);
    } else {
      throw error;
    }
  }
}
