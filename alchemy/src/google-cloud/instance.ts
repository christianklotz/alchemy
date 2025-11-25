import type { protos } from "@google-cloud/compute";
import type { Context } from "../context.ts";
import { Resource, ResourceKind } from "../resource.ts";
import { logger } from "../util/logger.ts";
import type { GoogleCloudClientProps } from "./client-props.ts";
import { resolveGoogleCloudCredentials } from "./credentials.ts";

/**
 * Properties for creating or updating a Google Cloud Compute Engine instance.
 */
export interface InstanceProps extends GoogleCloudClientProps {
  /**
   * Name of the instance.
   * @default ${app}-${stage}-${id}
   */
  name?: string;

  /**
   * Zone for the instance (e.g., "us-central1-a").
   */
  zone: string;

  /**
   * Machine type (e.g., "n1-standard-1", "e2-medium").
   * @default "e2-medium"
   */
  machineType?: string;

  /**
   * Boot disk source image.
   * @default "projects/debian-cloud/global/images/family/debian-11"
   */
  sourceImage?: string;

  /**
   * Boot disk size in GB.
   * @default 10
   */
  diskSizeGb?: number;

  /**
   * Boot disk type.
   * @default "pd-standard"
   */
  diskType?: "pd-standard" | "pd-balanced" | "pd-ssd";

  /**
   * Network name (uses default if not specified).
   * @default "default"
   */
  network?: string;

  /**
   * Whether to assign an external IP.
   * @default true
   */
  assignExternalIp?: boolean;

  /**
   * Startup script to run on boot.
   */
  startupScript?: string;

  /**
   * Labels to apply to the instance.
   */
  labels?: Record<string, string>;

  /**
   * Tags for firewall rules.
   */
  tags?: string[];
}

/**
 * Output type for a Google Cloud Compute Engine instance.
 */
export type Instance = Omit<InstanceProps, "keyFilename"> & {
  /**
   * The instance self-link URL.
   */
  selfLink: string;

  /**
   * Instance status.
   */
  status:
    | "PROVISIONING"
    | "STAGING"
    | "RUNNING"
    | "STOPPING"
    | "STOPPED"
    | "TERMINATED"
    | "SUSPENDED"
    | "SUSPENDING"
    | "REPAIRING";

  /**
   * Internal IP address.
   */
  internalIp?: string;

  /**
   * External IP address (if assigned).
   */
  externalIp?: string;

  /**
   * Creation timestamp.
   */
  createdAt: string;

  /**
   * Resource type identifier.
   */
  type: "google-cloud-instance";
};

/**
 * Type guard for Instance resource.
 */
export function isInstance(resource: unknown): resource is Instance {
  return (
    typeof resource === "object" &&
    resource !== null &&
    (resource as any)[ResourceKind] === "google-cloud::Instance"
  );
}

/**
 * Google Cloud Compute Engine Instance Resource
 *
 * Creates and manages Google Cloud virtual machine instances.
 *
 * @example
 * ## Create a basic VM instance
 *
 * Creates a simple VM with default settings.
 *
 * ```ts
 * import { Instance } from "alchemy/google-cloud";
 *
 * const vm = await Instance("web-server", {
 *   zone: "us-central1-a",
 *   machineType: "e2-medium",
 * });
 *
 * console.log(vm.externalIp);
 * ```
 *
 * @example
 * ## Create a VM with custom configuration
 *
 * Creates a VM with custom disk, network, and startup script.
 *
 * ```ts
 * import { Instance } from "alchemy/google-cloud";
 *
 * const vm = await Instance("app-server", {
 *   zone: "us-west1-b",
 *   machineType: "n1-standard-2",
 *   sourceImage: "projects/ubuntu-os-cloud/global/images/family/ubuntu-2204-lts",
 *   diskSizeGb: 50,
 *   diskType: "pd-ssd",
 *   assignExternalIp: true,
 *   startupScript: `#!/bin/bash
 *     apt-get update
 *     apt-get install -y nginx
 *   `,
 *   labels: {
 *     environment: "production",
 *     team: "backend",
 *   },
 *   tags: ["http-server", "https-server"],
 * });
 * ```
 *
 * @example
 * ## Create a VM with explicit project
 *
 * Specifies the GCP project explicitly.
 *
 * ```ts
 * import { Instance } from "alchemy/google-cloud";
 *
 * const vm = await Instance("worker", {
 *   project: "my-gcp-project",
 *   zone: "europe-west1-b",
 *   machineType: "e2-small",
 * });
 * ```
 */
export const Instance = Resource(
  "google-cloud::Instance",
  async function (
    this: Context<Instance>,
    id: string,
    props: InstanceProps,
  ): Promise<Instance> {
    // Resolve credentials
    const credentials = await resolveGoogleCloudCredentials(props);
    const project = credentials.project;

    if (!project) {
      throw new Error(
        "Google Cloud project is required. Set GOOGLE_CLOUD_PROJECT environment variable or pass project in props.",
      );
    }

    // Generate instance name
    const name =
      props.name ?? this.output?.name ?? this.scope.createPhysicalName(id);
    const zone = props.zone;
    const machineType = props.machineType ?? "e2-medium";
    const sourceImage =
      props.sourceImage ??
      "projects/debian-cloud/global/images/family/debian-11";
    const diskSizeGb = props.diskSizeGb ?? 10;
    const diskType = props.diskType ?? "pd-standard";
    const network = props.network ?? "default";
    const assignExternalIp = props.assignExternalIp ?? true;

    // Import the compute client dynamically to handle optional peer dependency
    const { InstancesClient, ZoneOperationsClient } = await import(
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

    const instancesClient = new InstancesClient(clientOptions);
    const operationsClient = new ZoneOperationsClient(clientOptions);

    if (this.phase === "delete") {
      if (this.output?.name) {
        logger.log(`Deleting instance: ${this.output.name}`);

        try {
          const [operation] = await instancesClient.delete({
            project,
            zone,
            instance: this.output.name,
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

          logger.log(`  Instance ${this.output.name} deleted`);
        } catch (error: unknown) {
          // Ignore 404 errors (instance already deleted)
          if (isNotFoundError(error)) {
            logger.log(`  Instance ${this.output.name} already deleted`);
          } else {
            throw error;
          }
        }
      }
      return this.destroy();
    }

    // Check for immutable property changes during update
    if (this.phase === "update" && this.output) {
      // Zone and name are immutable - require replacement
      if (this.output.zone !== zone) {
        logger.log(
          `Zone changed from ${this.output.zone} to ${zone}, replacing instance`,
        );
        return this.replace();
      }
      if (this.output.name !== name) {
        logger.log(
          `Name changed from ${this.output.name} to ${name}, replacing instance`,
        );
        return this.replace();
      }
    }

    // Build the instance resource
    const instanceResource: protos.google.cloud.compute.v1.IInstance = {
      name,
      machineType: `zones/${zone}/machineTypes/${machineType}`,
      disks: [
        {
          boot: true,
          autoDelete: true,
          initializeParams: {
            sourceImage,
            diskSizeGb: diskSizeGb.toString(),
            diskType: `zones/${zone}/diskTypes/${diskType}`,
          },
        },
      ],
      networkInterfaces: [
        {
          network: `global/networks/${network}`,
          accessConfigs: assignExternalIp
            ? [
                {
                  name: "External NAT",
                  type: "ONE_TO_ONE_NAT",
                },
              ]
            : [],
        },
      ],
      labels: props.labels,
      tags: props.tags ? { items: props.tags } : undefined,
      metadata: props.startupScript
        ? {
            items: [
              {
                key: "startup-script",
                value: props.startupScript,
              },
            ],
          }
        : undefined,
    };

    let instance: protos.google.cloud.compute.v1.IInstance;

    if (this.phase === "update" && this.output?.name) {
      // For updates, we need to handle different properties differently
      // Labels can be updated via setLabels
      // Tags can be updated via setTags
      // Machine type requires stop -> update -> start

      // For simplicity in MVP, we'll update labels and tags if changed
      // Machine type changes require replacement (handled above with zone/name)

      // Get current instance state
      const [currentInstance] = await instancesClient.get({
        project,
        zone,
        instance: name,
      });

      instance = currentInstance;

      // Update labels if changed
      if (
        props.labels &&
        JSON.stringify(props.labels) !==
          JSON.stringify(currentInstance.labels || {})
      ) {
        const [labelOperation] = await instancesClient.setLabels({
          project,
          zone,
          instance: name,
          instancesSetLabelsRequestResource: {
            labels: props.labels,
            labelFingerprint: currentInstance.labelFingerprint,
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

      // Update tags if changed
      if (props.tags) {
        const currentTags = currentInstance.tags?.items || [];
        if (
          JSON.stringify(props.tags.sort()) !==
          JSON.stringify(currentTags.sort())
        ) {
          const [tagsOperation] = await instancesClient.setTags({
            project,
            zone,
            instance: name,
            tagsResource: {
              items: props.tags,
              fingerprint: currentInstance.tags?.fingerprint,
            },
          });

          if (tagsOperation.name) {
            await waitForZoneOperation(
              operationsClient,
              project,
              zone,
              tagsOperation.name,
            );
          }
        }
      }

      // Refresh instance data
      const [updatedInstance] = await instancesClient.get({
        project,
        zone,
        instance: name,
      });
      instance = updatedInstance;
    } else {
      // Create new instance
      logger.log(`Creating instance: ${name}`);

      const [operation] = await instancesClient.insert({
        project,
        zone,
        instanceResource,
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

      // Get the created instance details
      const [createdInstance] = await instancesClient.get({
        project,
        zone,
        instance: name,
      });
      instance = createdInstance;

      logger.log(`  Instance ${name} created`);
    }

    // Extract IP addresses
    const networkInterface = instance.networkInterfaces?.[0];
    const internalIp = networkInterface?.networkIP || undefined;
    const externalIp = networkInterface?.accessConfigs?.[0]?.natIP || undefined;

    return {
      name,
      zone,
      project,
      machineType,
      sourceImage,
      diskSizeGb,
      diskType,
      network,
      assignExternalIp,
      startupScript: props.startupScript,
      labels: props.labels,
      tags: props.tags,
      selfLink: instance.selfLink || "",
      status: (instance.status as Instance["status"]) || "RUNNING",
      internalIp,
      externalIp,
      createdAt: instance.creationTimestamp || new Date().toISOString(),
      type: "google-cloud-instance",
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
