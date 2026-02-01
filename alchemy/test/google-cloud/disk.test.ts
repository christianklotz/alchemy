import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { destroy } from "../../src/destroy.ts";
import { Disk } from "../../src/google-cloud/disk.ts";
import { Instance } from "../../src/google-cloud/instance.ts";
import { BRANCH_PREFIX } from "../util.ts";

import "../../src/test/vitest.ts";

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

// Test timeout for GCP operations (5 minutes)
const TIMEOUT = 5 * 60 * 1000;

describe.skipIf(!process.env.ALL_TESTS)("Google Cloud Disk", () => {
  test(
    "attach disk to instance",
    async (scope) => {
      const diskName = `${BRANCH_PREFIX}-data-disk`;
      const instanceName = `${BRANCH_PREFIX}-vm-with-disk`;
      const zone = "us-central1-a";

      if (!process.env.GOOGLE_CLOUD_PROJECT) {
        throw new Error(
          "GOOGLE_CLOUD_PROJECT environment variable is required",
        );
      }

      try {
        // Create standalone disk
        const disk = await Disk(diskName, {
          name: diskName,
          zone,
          sizeGb: 10,
          diskType: "pd-standard",
          adopt: true, // Adopt if exists from previous test run
          delete: true, // Enable deletion for test cleanup
        });

        expect(disk.name).toBe(diskName);
        expect(disk.selfLink).toBeTruthy();

        // Attach to instance - tests Alchemy's Disk|string resolution
        const instance = await Instance(instanceName, {
          name: instanceName,
          zone,
          machineType: "e2-micro",
          adopt: true, // Adopt if exists from previous test run
          additionalDisks: [
            {
              disk: disk, // Disk resource, not string
              deviceName: "data-disk",
              mode: "READ_WRITE",
            },
          ],
        });

        // Verify Alchemy resolved the Disk resource correctly
        expect(instance.additionalDisks).toHaveLength(1);
        expect(instance.additionalDisks?.[0].diskSelfLink).toBe(disk.selfLink);
        expect(instance.additionalDisks?.[0].deviceName).toBe("data-disk");
        expect(instance.additionalDisks?.[0].mode).toBe("READ_WRITE");
        expect(instance.additionalDisks?.[0].autoDelete).toBe(false);
      } finally {
        await destroy(scope);
      }
    },
    TIMEOUT,
  );
});
