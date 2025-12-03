import type { Context } from "../context.ts";
import { Resource, ResourceKind } from "../resource.ts";
import { logger } from "../util/logger.ts";
import type { GoogleCloudClientProps } from "./client-props.ts";
import { resolveGoogleCloudCredentials } from "./credentials.ts";

/**
 * Persistent disk type.
 *
 * Note: Hyperdisk types (hyperdisk-balanced, hyperdisk-extreme, hyperdisk-throughput)
 * are not yet implemented.
 */
export type PersistentDiskType =
  | "pd-standard"
  | "pd-balanced"
  | "pd-ssd"
  | "pd-extreme";

/**
 * Properties for creating or updating a Google Cloud Persistent Disk.
 */
export interface DiskProps extends GoogleCloudClientProps {
  /**
   * Name of the disk.
   * @default ${app}-${stage}-${id}
   */
  name?: string;

  /**
   * Zone for the disk (e.g., "us-central1-a").
   */
  zone: string;

  /**
   * Size of the disk in GB (10-65536).
   */
  sizeGb: number;

  /**
   * Disk type. Persistent Disk types only.
   *
   * Note: Hyperdisk types (hyperdisk-balanced, hyperdisk-extreme, hyperdisk-throughput)
   * are not yet implemented.
   *
   * @default "pd-standard"
   */
  diskType?: PersistentDiskType;

  /**
   * Source image to create the disk from.
   * Mutually exclusive with sourceSnapshot.
   */
  sourceImage?: string;

  /**
   * Source snapshot to create the disk from.
   * Mutually exclusive with sourceImage.
   */
  sourceSnapshot?: string;

  /**
   * Labels to apply to the disk.
   */
  labels?: Record<string, string>;

  /**
   * Whether to delete the disk when removed from Alchemy.
   * Since disks contain data, this defaults to false for safety.
   * @default false
   */
  delete?: boolean;

  /**
   * Whether to adopt an existing disk if it already exists.
   * @default false
   */
  adopt?: boolean;
}

/**
 * Output type for a Google Cloud Persistent Disk.
 */
export type Disk = Omit<DiskProps, "keyFilename" | "delete"> & {
  /**
   * The disk self-link URL.
   */
  selfLink: string;

  /**
   * Disk status.
   */
  status: "CREATING" | "RESTORING" | "FAILED" | "READY" | "DELETING";

  /**
   * Creation timestamp.
   */
  createdAt: string;

  /**
   * Resource type identifier.
   */
  type: "google-cloud-disk";
};

/**
 * Type guard for Disk resource.
 */
export function isDisk(resource: unknown): resource is Disk {
  return (
    typeof resource === "object" &&
    resource !== null &&
    (resource as any)[ResourceKind] === "google-cloud::Disk"
  );
}

/**
 * Google Cloud Persistent Disk Resource
 *
 * Creates and manages Google Cloud persistent disks that can be attached to VM instances.
 *
 * @example
 * ## Create a basic persistent disk
 *
 * Creates a simple persistent disk with default settings.
 *
 * ```ts
 * import { Disk } from "alchemy/google-cloud";
 *
 * const disk = await Disk("data-disk", {
 *   zone: "us-central1-a",
 *   sizeGb: 100,
 * });
 *
 * console.log(disk.selfLink);
 * ```
 *
 * @example
 * ## Create an SSD disk with labels
 *
 * Creates a high-performance SSD disk with custom labels.
 *
 * ```ts
 * import { Disk } from "alchemy/google-cloud";
 *
 * const disk = await Disk("fast-storage", {
 *   zone: "us-west1-b",
 *   sizeGb: 500,
 *   diskType: "pd-ssd",
 *   labels: {
 *     environment: "production",
 *     team: "backend",
 *   },
 * });
 * ```
 *
 * @example
 * ## Create a disk from a snapshot
 *
 * Creates a disk from an existing snapshot.
 *
 * ```ts
 * import { Disk } from "alchemy/google-cloud";
 *
 * const disk = await Disk("restored-disk", {
 *   zone: "us-central1-a",
 *   sizeGb: 100,
 *   sourceSnapshot: "projects/my-project/global/snapshots/my-snapshot",
 * });
 * ```
 *
 * @example
 * ## Attach disk to an instance
 *
 * Creates a disk and attaches it to a VM instance.
 *
 * ```ts
 * import { Disk, Instance } from "alchemy/google-cloud";
 *
 * const dataDisk = await Disk("data", {
 *   zone: "us-central1-a",
 *   sizeGb: 200,
 *   diskType: "pd-balanced",
 * });
 *
 * const vm = await Instance("server", {
 *   zone: "us-central1-a",
 *   machineType: "e2-medium",
 *   additionalDisks: [{
 *     disk: dataDisk,
 *     deviceName: "data-disk",
 *   }],
 * });
 * ```
 */
export const Disk = Resource(
  "google-cloud::Disk",
  async function (
    this: Context<Disk>,
    id: string,
    props: DiskProps,
  ): Promise<Disk> {
    // Resolve credentials
    const credentials = await resolveGoogleCloudCredentials(props);
    const project = credentials.project;

    if (!project) {
      throw new Error(
        "Google Cloud project is required. Set GOOGLE_CLOUD_PROJECT environment variable or pass project in props.",
      );
    }

    // Generate disk name
    const name =
      props.name ?? this.output?.name ?? this.scope.createPhysicalName(id);
    const zone = props.zone;
    const diskType = props.diskType ?? "pd-standard";
    const sizeGb = props.sizeGb;

    // Validate size
    if (sizeGb < 10 || sizeGb > 65536) {
      throw new Error(
        `Disk size must be between 10 and 65536 GB, got ${sizeGb}`,
      );
    }

    // Validate mutually exclusive options
    if (props.sourceImage && props.sourceSnapshot) {
      throw new Error("sourceImage and sourceSnapshot are mutually exclusive");
    }

    // Import the compute client dynamically to handle optional peer dependency
    const { DisksClient, ZoneOperationsClient } = await import(
      "@google-cloud/compute"
    );

    // Create clients with resolved credentials
    const clientOptions: { projectId?: string; keyFilename?: string } = {};
    if (credentials.project) {
      clientOptions.projectId = credentials.project;
    }
    if (credentials.keyFilename) {
      clientOptions.keyFilename = credentials.keyFilename;
    }

    const disksClient = new DisksClient(clientOptions);
    const operationsClient = new ZoneOperationsClient(clientOptions);

    if (this.phase === "delete") {
      // Only delete if explicitly requested (data resource safety pattern)
      if (props.delete !== false && this.output?.name) {
        logger.log(`Deleting disk: ${this.output.name}`);

        try {
          const [operation] = await disksClient.delete({
            project,
            zone,
            disk: this.output.name,
          });

          // Wait for operation to complete
          if (operation.name) {
            await waitForZoneOperation(
              operationsClient,
              project,
              zone,
              operation.name,
            );
          }

          logger.log(`  Disk ${this.output.name} deleted`);
        } catch (error: unknown) {
          // Ignore 404 errors (disk already deleted)
          if (isNotFoundError(error)) {
            logger.log(`  Disk ${this.output.name} already deleted`);
          } else {
            throw error;
          }
        }
      } else if (props.delete === false) {
        logger.log(
          `Skipping deletion of disk ${this.output?.name} (delete: false)`,
        );
      }
      return this.destroy();
    }

    // Check for immutable property changes during update
    if (this.phase === "update" && this.output) {
      // Zone is immutable - require replacement
      if (this.output.zone !== zone) {
        logger.log(
          `Zone changed from ${this.output.zone} to ${zone}, replacing disk`,
        );
        return this.replace();
      }
      // Name is immutable - require replacement
      if (this.output.name !== name) {
        logger.log(
          `Name changed from ${this.output.name} to ${name}, replacing disk`,
        );
        return this.replace();
      }
      // Disk type is immutable - require replacement
      if (this.output.diskType !== diskType) {
        logger.log(
          `Disk type changed from ${this.output.diskType} to ${diskType}, replacing disk`,
        );
        return this.replace();
      }
      // Size can only increase, not decrease
      if (this.output.sizeGb !== sizeGb) {
        if (sizeGb < this.output.sizeGb) {
          throw new Error(
            `Cannot decrease disk size from ${this.output.sizeGb} GB to ${sizeGb} GB. Disk size can only be increased.`,
          );
        }
        // Resize the disk
        logger.log(
          `Resizing disk from ${this.output.sizeGb} GB to ${sizeGb} GB`,
        );
        const [resizeOperation] = await disksClient.resize({
          project,
          zone,
          disk: name,
          disksResizeRequestResource: {
            sizeGb: sizeGb.toString(),
          },
        });
        if (resizeOperation.name) {
          await waitForZoneOperation(
            operationsClient,
            project,
            zone,
            resizeOperation.name,
          );
        }
      }
    }

    let disk: {
      selfLink?: string | null;
      status?: string | null;
      creationTimestamp?: string | null;
    };

    if (this.phase === "update" && this.output?.name) {
      // Get current disk state
      const [currentDisk] = await disksClient.get({
        project,
        zone,
        disk: name,
      });

      disk = currentDisk;

      // Update labels if changed
      if (
        props.labels &&
        JSON.stringify(props.labels) !==
          JSON.stringify(currentDisk.labels || {})
      ) {
        const [labelOperation] = await disksClient.setLabels({
          project,
          zone,
          resource: name,
          zoneSetLabelsRequestResource: {
            labels: props.labels,
            labelFingerprint: currentDisk.labelFingerprint,
          },
        });

        if (labelOperation.name) {
          await waitForZoneOperation(
            operationsClient,
            project,
            zone,
            labelOperation.name,
          );
        }
      }

      // Refresh disk data
      const [updatedDisk] = await disksClient.get({
        project,
        zone,
        disk: name,
      });
      disk = updatedDisk;
    } else {
      // Create new disk
      logger.log(`Creating disk: ${name}`);

      const diskResource: {
        name: string;
        sizeGb: string;
        type: string;
        labels?: Record<string, string>;
        sourceImage?: string;
        sourceSnapshot?: string;
      } = {
        name,
        sizeGb: sizeGb.toString(),
        type: `zones/${zone}/diskTypes/${diskType}`,
        labels: props.labels,
      };

      if (props.sourceImage) {
        diskResource.sourceImage = props.sourceImage;
      }
      if (props.sourceSnapshot) {
        diskResource.sourceSnapshot = props.sourceSnapshot;
      }

      try {
        const [operation] = await disksClient.insert({
          project,
          zone,
          diskResource,
        });

        // Wait for operation to complete
        if (operation.name) {
          await waitForZoneOperation(
            operationsClient,
            project,
            zone,
            operation.name,
          );
        }

        // Get the created disk details
        const [createdDisk] = await disksClient.get({
          project,
          zone,
          disk: name,
        });
        disk = createdDisk;

        logger.log(`  Disk ${name} created`);
      } catch (error: unknown) {
        if (isAlreadyExistsError(error)) {
          const adopt = props.adopt ?? this.scope.adopt;
          if (!adopt) {
            throw new Error(
              `Disk "${name}" already exists. Use adopt: true to adopt it.`,
              { cause: error },
            );
          }
          logger.log(`  Disk ${name} already exists, adopting`);
          const [existing] = await disksClient.get({
            project,
            zone,
            disk: name,
          });
          disk = existing;
        } else {
          throw error;
        }
      }
    }

    return {
      name,
      zone,
      project,
      sizeGb,
      diskType,
      sourceImage: props.sourceImage,
      sourceSnapshot: props.sourceSnapshot,
      labels: props.labels,
      selfLink: disk.selfLink || "",
      status: (disk.status as Disk["status"]) || "READY",
      createdAt: disk.creationTimestamp || new Date().toISOString(),
      type: "google-cloud-disk",
    };
  },
);

/**
 * Wait for a zone operation to complete.
 */
async function waitForZoneOperation(
  operationsClient: InstanceType<
    typeof import("@google-cloud/compute").ZoneOperationsClient
  >,
  project: string,
  zone: string,
  operationName: string,
): Promise<void> {
  const maxAttempts = 60;
  const delayMs = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const [operation] = await operationsClient.get({
      project,
      zone,
      operation: operationName,
    });

    if (operation.status === "DONE") {
      if (operation.error?.errors?.length) {
        const errors = operation.error.errors
          .map((e) => `${e.code}: ${e.message}`)
          .join(", ");
        throw new Error(`Operation failed: ${errors}`);
      }
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(
    `Operation ${operationName} timed out after ${maxAttempts * delayMs}ms`,
  );
}

/**
 * Check if an error is a 404 Not Found error.
 */
function isNotFoundError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: number }).code === 404;
  }
  return false;
}

/**
 * Check if an error is a 409 Conflict (already exists) error.
 */
function isAlreadyExistsError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: number }).code === 409;
  }
  return false;
}
