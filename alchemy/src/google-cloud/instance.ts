import type { protos } from "@google-cloud/compute";
import type { Context } from "../context.ts";
import type { Image } from "../docker/image.ts";
import { Resource, ResourceKind } from "../resource.ts";
import { logger } from "../util/logger.ts";
import type { GoogleCloudClientProps } from "./client-props.ts";
import { resolveGoogleCloudCredentials } from "./credentials.ts";

/**
 * Port mapping for container configuration.
 */
export interface ContainerPortMapping {
  /**
   * Port on the host VM.
   */
  hostPort: number;

  /**
   * Port inside the container.
   */
  containerPort: number;

  /**
   * Protocol for the port mapping.
   * @default "tcp"
   */
  protocol?: "tcp" | "udp";
}

/**
 * Volume mount for container configuration.
 */
export interface ContainerVolumeMount {
  /**
   * Path on the host VM.
   */
  hostPath: string;

  /**
   * Path inside the container.
   */
  containerPath: string;

  /**
   * Whether the mount is read-only.
   * @default false
   */
  readOnly?: boolean;
}

/**
 * Container configuration for running a container on a Google Cloud VM.
 * When specified, the instance uses Container-Optimized OS and runs the container via docker.
 */
export interface ContainerConfig {
  /**
   * Container image - either an Alchemy Image resource or a string reference.
   * Image resource handles build+push to registries.
   * String can be a public image (e.g., "nginx:alpine") or a registry URL.
   */
  image: Image | string;

  /**
   * Environment variables for the container.
   */
  env?: Record<string, string>;

  /**
   * Port mappings from host to container.
   */
  ports?: ContainerPortMapping[];

  /**
   * Volume mounts from host to container.
   */
  volumes?: ContainerVolumeMount[];

  /**
   * Restart policy for the container.
   * @default "always"
   */
  restartPolicy?: "always" | "on-failure" | "no";

  /**
   * Override the container's default command.
   */
  command?: string[];

  /**
   * Run the container in privileged mode.
   * @default false
   */
  privileged?: boolean;
}

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

  /**
   * Container configuration. When specified:
   * - Uses Container-Optimized OS (cos-cloud/cos-stable)
   * - Generates startup script to pull and run the container
   * - sourceImage prop is ignored
   */
  container?: ContainerConfig;

  /**
   * Service account scopes for the instance.
   * When container is specified, defaults to ["https://www.googleapis.com/auth/cloud-platform"]
   * to allow pulling images from Artifact Registry.
   * @default ["https://www.googleapis.com/auth/devstorage.read_only", "https://www.googleapis.com/auth/logging.write"]
   */
  serviceAccountScopes?: string[];
}

/**
 * Resolved container configuration in the output.
 */
export interface ResolvedContainerConfig
  extends Omit<ContainerConfig, "image"> {
  /**
   * Resolved image reference used for deployment.
   * This is the actual image URL/tag that was deployed.
   */
  imageRef: string;
}

/**
 * Output type for a Google Cloud Compute Engine instance.
 */
export type Instance = Omit<InstanceProps, "keyFilename" | "container"> & {
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
   * Container configuration with resolved image reference.
   */
  container?: ResolvedContainerConfig;

  /**
   * Service account scopes.
   */
  serviceAccountScopes?: string[];

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
 * Container-Optimized OS image for container deployments.
 *
 * COS is a minimal, security-hardened OS maintained by Google with Docker pre-installed.
 *
 * @see https://cloud.google.com/container-optimized-os/docs
 */
const COS_IMAGE = "projects/cos-cloud/global/images/family/cos-stable";

/**
 * Generate a startup script for running a container on Container-Optimized OS.
 *
 * This approach uses COS + startup script with `docker run` instead of the
 * `create-with-container` API because:
 *
 * 1. The `create-with-container` API is deprecated and only available via
 *    Console/CLI, not the Compute API
 * 2. Google recommends using startup scripts or cloud-init for container
 *    orchestration
 * 3. This approach provides more flexibility (custom docker run options,
 *    multiple containers, etc.)
 *
 * @see https://cloud.google.com/compute/docs/containers - Container deployment overview
 * @see https://cloud.google.com/compute/docs/containers/deploying-containers - Deployment guide
 * @see https://cloud.google.com/compute/docs/containers/configuring-options-to-run-containers - Configuration options
 */
function generateContainerStartupScript(
  container: ContainerConfig,
  imageRef: string,
): string {
  const lines: string[] = ["#!/bin/bash", "set -e", ""];

  // Check if this is an Artifact Registry or GCR image that needs auth
  const needsGcloudAuth =
    imageRef.includes(".pkg.dev") || imageRef.includes("gcr.io");

  if (needsGcloudAuth) {
    // Extract the registry host for docker-credential-gcr
    const registryHost = imageRef.split("/")[0];
    lines.push(`# Authenticate to Google Container Registry`);
    lines.push(`# On COS, use docker-credential-gcr with a writable config directory`);
    lines.push(`export HOME=/home/chronos`);
    lines.push(`mkdir -p /home/chronos/.docker`);
    lines.push(`docker-credential-gcr configure-docker --registries=${registryHost}`);
    lines.push("");
  }

  // Build docker run command
  const dockerArgs: string[] = ["docker", "run", "-d"];

  // Container name
  dockerArgs.push("--name", "alchemy-container");

  // Restart policy
  const restartPolicy = container.restartPolicy ?? "always";
  dockerArgs.push("--restart", restartPolicy);

  // Privileged mode
  if (container.privileged) {
    dockerArgs.push("--privileged");
  }

  // Port mappings
  if (container.ports) {
    for (const port of container.ports) {
      const protocol = port.protocol ?? "tcp";
      dockerArgs.push(
        "-p",
        `${port.hostPort}:${port.containerPort}/${protocol}`,
      );
    }
  }

  // Environment variables
  if (container.env) {
    for (const [key, value] of Object.entries(container.env)) {
      // Escape single quotes in values
      const escapedValue = value.replace(/'/g, "'\\''");
      dockerArgs.push("-e", `${key}='${escapedValue}'`);
    }
  }

  // Volume mounts
  if (container.volumes) {
    for (const vol of container.volumes) {
      const mountOpt = vol.readOnly ? ":ro" : "";
      dockerArgs.push("-v", `${vol.hostPath}:${vol.containerPath}${mountOpt}`);
    }
  }

  // Image reference
  dockerArgs.push(imageRef);

  // Command override
  if (container.command && container.command.length > 0) {
    dockerArgs.push(...container.command);
  }

  lines.push("# Pull and run the container");
  lines.push(dockerArgs.join(" \\\n  "));

  return lines.join("\n");
}

/**
 * Resolve the image reference from a ContainerConfig.
 */
function resolveImageRef(container: ContainerConfig): string {
  if (typeof container.image === "string") {
    return container.image;
  }
  // Image resource - prefer repoDigest for immutability, fallback to imageRef
  return container.image.repoDigest ?? container.image.imageRef;
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
 * ## Deploy a container to a VM
 *
 * Creates a VM running a container using Container-Optimized OS.
 *
 * ```ts
 * import { Instance } from "alchemy/google-cloud";
 *
 * const vm = await Instance("container-vm", {
 *   zone: "us-central1-a",
 *   machineType: "e2-small",
 *   container: {
 *     image: "nginx:alpine",
 *     ports: [{ hostPort: 80, containerPort: 80 }],
 *     env: { NGINX_HOST: "example.com" },
 *   },
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

    // Resolve container configuration if specified
    let resolvedContainer: ResolvedContainerConfig | undefined;
    let containerImageRef: string | undefined;
    if (props.container) {
      containerImageRef = resolveImageRef(props.container);
      const { image: _image, ...containerWithoutImage } = props.container;
      resolvedContainer = {
        ...containerWithoutImage,
        imageRef: containerImageRef,
      };
    }

    // Use COS image if container is specified, otherwise use provided/default image
    const sourceImage = props.container
      ? COS_IMAGE
      : (props.sourceImage ??
        "projects/debian-cloud/global/images/family/debian-11");

    const diskSizeGb = props.diskSizeGb ?? 10;
    const diskType = props.diskType ?? "pd-standard";
    const network = props.network ?? "default";
    const assignExternalIp = props.assignExternalIp ?? true;

    // Generate startup script - container script takes precedence
    let startupScript = props.startupScript;
    if (props.container && containerImageRef) {
      startupScript = generateContainerStartupScript(
        props.container,
        containerImageRef,
      );
    }

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
      // Container image change requires replacement (startup script is baked into instance)
      if (containerImageRef !== this.output.container?.imageRef) {
        logger.log(
          `Container image changed from ${this.output.container?.imageRef} to ${containerImageRef}, replacing instance`,
        );
        return this.replace();
      }
      // Adding or removing container requires replacement
      if (!!props.container !== !!this.output.container) {
        logger.log(
          `Container configuration ${
            props.container ? "added" : "removed"
          }, replacing instance`,
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
      metadata: startupScript
        ? {
            items: [
              {
                key: "startup-script",
                value: startupScript,
              },
            ],
          }
        : undefined,
      // Service account with scopes for registry access
      serviceAccounts: [
        {
          email: "default",
          scopes:
            props.serviceAccountScopes ??
            (props.container
              ? // Container deployments need broader scope for Artifact Registry
                ["https://www.googleapis.com/auth/cloud-platform"]
              : // Default scopes for basic logging
                [
                  "https://www.googleapis.com/auth/devstorage.read_only",
                  "https://www.googleapis.com/auth/logging.write",
                ]),
        },
      ],
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
      startupScript: props.container ? undefined : props.startupScript,
      labels: props.labels,
      tags: props.tags,
      container: resolvedContainer,
      serviceAccountScopes: props.serviceAccountScopes,
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
