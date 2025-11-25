import { InstancesClient } from "@google-cloud/compute";
import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { destroy } from "../../src/destroy.ts";
import { Instance } from "../../src/google-cloud/instance.ts";
import { BRANCH_PREFIX } from "../util.ts";

import "../../src/test/vitest.ts";

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

// Test timeout for instance operations (5 minutes)
const INSTANCE_TIMEOUT = 5 * 60 * 1000;

describe.skipIf(!process.env.ALL_TESTS)("Google Cloud Instance", () => {
  test(
    "create, update, and delete instance",
    async (scope) => {
      const instanceName = `${BRANCH_PREFIX}-test-vm`;
      const zone = "us-central1-a";
      const project = process.env.GOOGLE_CLOUD_PROJECT;

      if (!project) {
        throw new Error(
          "GOOGLE_CLOUD_PROJECT environment variable is required",
        );
      }

      let instance: Awaited<ReturnType<typeof Instance>>;

      try {
        // Create instance with custom configuration
        instance = await Instance(instanceName, {
          name: instanceName,
          zone,
          machineType: "e2-micro",
          diskSizeGb: 10,
          assignExternalIp: true,
          tags: ["http-server"],
          labels: {
            environment: "test",
          },
        });

        expect(instance.name).toBe(instanceName);
        expect(instance.zone).toBe(zone);
        expect(instance.machineType).toBe("e2-micro");
        expect(instance.diskSizeGb).toBe(10);
        expect(instance.assignExternalIp).toBe(true);
        expect(instance.status).toBeTruthy();
        expect(instance.selfLink).toBeTruthy();
        expect(instance.internalIp).toBeTruthy();
        expect(instance.tags).toEqual(["http-server"]);
        expect(instance.labels).toEqual({
          environment: "test",
        });

        // Verify instance exists via Google Cloud API
        const client = new InstancesClient();
        const [fetchedInstance] = await client.get({
          project,
          zone,
          instance: instanceName,
        });
        expect(fetchedInstance.name).toBe(instanceName);
        expect(fetchedInstance.status).toBe("RUNNING");

        // Update labels
        instance = await Instance(instanceName, {
          name: instanceName,
          zone,
          machineType: "e2-micro",
          diskSizeGb: 10,
          assignExternalIp: true,
          tags: ["http-server"],
          labels: {
            environment: "production",
            updated: "true",
          },
        });

        expect(instance.labels).toEqual({
          environment: "production",
          updated: "true",
        });

        // Verify labels updated via API
        const [updatedInstance] = await client.get({
          project,
          zone,
          instance: instanceName,
        });
        expect(updatedInstance.labels).toEqual({
          environment: "production",
          updated: "true",
        });
      } finally {
        console.log("Starting cleanup...");
        await destroy(scope);
        console.log("Cleanup completed!");
      }
    },
    INSTANCE_TIMEOUT,
  );

  test(
    "scope-level credentials",
    async (scope) => {
      const instanceName = `${BRANCH_PREFIX}-test-vm-scope`;
      const zone = "us-central1-a";
      const project = process.env.GOOGLE_CLOUD_PROJECT;

      if (!project) {
        throw new Error(
          "GOOGLE_CLOUD_PROJECT environment variable is required",
        );
      }

      try {
        await alchemy.run(
          "test-scope",
          {
            googleCloud: {
              project,
            },
          },
          async () => {
            const instance = await Instance(instanceName, {
              name: instanceName,
              zone,
              machineType: "e2-micro",
            });

            expect(instance.name).toBe(instanceName);
            expect(instance.project).toBe(project);
          },
        );
      } finally {
        await destroy(scope);
      }
    },
    INSTANCE_TIMEOUT,
  );
});
