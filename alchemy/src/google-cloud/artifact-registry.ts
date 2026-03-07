import type { Context } from "../context.ts";
import { Resource, ResourceKind } from "../resource.ts";
import { logger } from "../util/logger.ts";
import type { GoogleCloudClientProps } from "./client-props.ts";
import { resolveGoogleCloudCredentials } from "./credentials.ts";
import { isAlreadyExistsError, isNotFoundError } from "./util.ts";

/**
 * Repository format types supported by Artifact Registry.
 */
export type RepositoryFormat =
  | "docker"
  | "maven"
  | "npm"
  | "python"
  | "apt"
  | "yum"
  | "go"
  | "kfp";

/**
 * Properties for creating or updating an Artifact Registry repository.
 */
export interface ArtifactRegistryProps extends GoogleCloudClientProps {
  /**
   * Name of the repository.
   * @default ${app}-${stage}-${id}
   */
  name?: string;

  /**
   * Whether to adopt an existing repository if it already exists.
   * @default false
   */
  adopt?: boolean;

  /**
   * Location (region) for the repository (e.g., "us-central1").
   */
  location: string;

  /**
   * Repository format.
   * @default "docker"
   */
  format?: RepositoryFormat;

  /**
   * Description of the repository.
   */
  description?: string;

  /**
   * Labels to apply to the repository.
   */
  labels?: Record<string, string>;

  /**
   * Whether tags are immutable. When enabled, tags cannot be moved or deleted.
   * Only applicable for Docker repositories.
   * @default false
   */
  immutableTags?: boolean;

  /**
   * Cloud KMS key name for customer-managed encryption.
   * Format: projects/{project}/locations/{location}/keyRings/{keyRing}/cryptoKeys/{key}
   * Cannot be changed after creation.
   */
  kmsKeyName?: string;

  /**
   * Whether to delete the repository when removed from Alchemy.
   * Since repositories contain data (container images, packages), this defaults to false for safety.
   * @default false
   */
  delete?: boolean;
}

/**
 * Output type for an Artifact Registry repository.
 */
export type ArtifactRegistry = Omit<
  ArtifactRegistryProps,
  "keyFilename" | "format" | "adopt" | "delete"
> & {
  /**
   * The repository name.
   */
  name: string;

  /**
   * The full resource name.
   */
  resourceName: string;

  /**
   * Repository format.
   */
  format: RepositoryFormat;

  /**
   * The Docker registry host for this repository.
   * Format: {location}-docker.pkg.dev/{project}/{repository}
   */
  host: string;

  /**
   * Creation timestamp.
   */
  createTime: string;

  /**
   * Last update timestamp.
   */
  updateTime: string;

  /**
   * Resource type identifier.
   */
  type: "google-cloud-artifact-registry";
};

/**
 * Type guard for ArtifactRegistry resource.
 */
export function isArtifactRegistry(
  resource: unknown,
): resource is ArtifactRegistry {
  return (
    typeof resource === "object" &&
    resource !== null &&
    (resource as any)[ResourceKind] === "google-cloud::ArtifactRegistry"
  );
}

/**
 * Google Cloud Artifact Registry Repository Resource
 *
 * Creates and manages Artifact Registry repositories for storing container images,
 * language packages, and other artifacts.
 *
 * @example
 * ## Create a Docker repository
 *
 * Creates a Docker repository for storing container images.
 *
 * ```ts
 * import { ArtifactRegistry } from "alchemy/google-cloud";
 *
 * const registry = await ArtifactRegistry("my-repo", {
 *   location: "us-central1",
 *   format: "docker",
 * });
 *
 * console.log(registry.host); // us-central1-docker.pkg.dev/my-project/my-repo
 * ```
 *
 * @example
 * ## Create a repository with immutable tags
 *
 * Creates a Docker repository where tags cannot be moved or deleted.
 *
 * ```ts
 * import { ArtifactRegistry } from "alchemy/google-cloud";
 *
 * const registry = await ArtifactRegistry("prod-images", {
 *   location: "us-central1",
 *   format: "docker",
 *   immutableTags: true,
 *   description: "Production container images",
 *   labels: {
 *     environment: "production",
 *   },
 * });
 * ```
 *
 * @example
 * ## Use with Docker Image resource
 *
 * Build and push an image to the repository.
 *
 * ```ts
 * import { ArtifactRegistry } from "alchemy/google-cloud";
 * import { Image } from "alchemy/docker";
 *
 * const registry = await ArtifactRegistry("app-images", {
 *   location: "us-central1",
 * });
 *
 * const image = await Image("my-app", {
 *   name: `${registry.host}/my-app`,
 *   tag: "latest",
 *   build: { context: "." },
 * });
 * ```
 */
export const ArtifactRegistry = Resource(
  "google-cloud::ArtifactRegistry",
  async function (
    this: Context<ArtifactRegistry>,
    id: string,
    props: ArtifactRegistryProps,
  ): Promise<ArtifactRegistry> {
    // Resolve credentials
    const credentials = await resolveGoogleCloudCredentials(props);
    const project = credentials.project;

    if (!project) {
      throw new Error(
        "Google Cloud project is required. Set GOOGLE_CLOUD_PROJECT environment variable or pass project in props.",
      );
    }

    // Generate repository name
    const name =
      props.name ?? this.output?.name ?? this.scope.createPhysicalName(id);
    const location = props.location;
    const format = props.format ?? "docker";

    // Local development mode - return mock data
    if (this.scope.local) {
      const host =
        format === "docker"
          ? `${location}-docker.pkg.dev/${project}/${name}`
          : `${location}-${format}.pkg.dev/${project}/${name}`;

      return {
        name,
        location,
        project,
        format,
        description: props.description,
        labels: props.labels,
        immutableTags: props.immutableTags,
        kmsKeyName: props.kmsKeyName,
        resourceName:
          this.output?.resourceName ??
          `projects/${project}/locations/${location}/repositories/${name}`,
        host,
        createTime: this.output?.createTime ?? new Date().toISOString(),
        updateTime: new Date().toISOString(),
        type: "google-cloud-artifact-registry",
      };
    }

    // Import the Artifact Registry client dynamically
    const { ArtifactRegistryClient } =
      await import("@google-cloud/artifact-registry");

    // Create client with resolved credentials
    const clientOptions: { projectId?: string; keyFilename?: string } = {};
    if (credentials.project) {
      clientOptions.projectId = credentials.project;
    }
    if (credentials.keyFilename) {
      clientOptions.keyFilename = credentials.keyFilename;
    }

    const client = new ArtifactRegistryClient(clientOptions);

    const repositoryPath = `projects/${project}/locations/${location}/repositories/${name}`;
    const parent = `projects/${project}/locations/${location}`;

    if (this.phase === "delete") {
      // Only delete if explicitly requested (data resource safety pattern)
      // Default is false to protect container images and packages
      if (props.delete === true && this.output?.name) {
        logger.log(`Deleting repository: ${this.output.name}`);

        try {
          const [operation] = await client.deleteRepository({
            name: repositoryPath,
          });
          await operation.promise();
          logger.log(`  Repository ${this.output.name} deleted`);
        } catch (error: unknown) {
          // Ignore 404 errors (repository already deleted)
          if (isNotFoundError(error)) {
            logger.log(`  Repository ${this.output.name} already deleted`);
          } else {
            throw error;
          }
        }
      } else if (props.delete !== true) {
        logger.log(
          `Skipping deletion of repository ${this.output?.name} (delete: false, preserving data)`,
        );
      }
      return this.destroy();
    }

    // Check for immutable property changes during update
    if (this.phase === "update" && this.output) {
      if (this.output.location !== location) {
        logger.log(
          `Location changed from ${this.output.location} to ${location}, replacing repository`,
        );
        return this.replace();
      }
      if (this.output.name !== name) {
        logger.log(
          `Name changed from ${this.output.name} to ${name}, replacing repository`,
        );
        return this.replace();
      }
      if (this.output.format !== format) {
        logger.log(
          `Format changed from ${this.output.format} to ${format}, replacing repository`,
        );
        return this.replace();
      }
      if (props.kmsKeyName && this.output.kmsKeyName !== props.kmsKeyName) {
        logger.log(
          `KMS key changed from ${this.output.kmsKeyName} to ${props.kmsKeyName}, replacing repository`,
        );
        return this.replace();
      }
    }

    let repository: {
      name?: string | null;
      createTime?: { seconds?: number | Long | string | null } | null;
      updateTime?: { seconds?: number | Long | string | null } | null;
    };

    if (this.phase === "update" && this.output?.name) {
      // Update existing repository (only mutable properties)
      logger.log(`Updating repository: ${name}`);

      const updateMask: string[] = [];
      const repositoryUpdate: {
        name: string;
        description?: string;
        labels?: Record<string, string>;
        dockerConfig?: { immutableTags?: boolean };
      } = {
        name: repositoryPath,
      };

      if (props.description !== undefined) {
        repositoryUpdate.description = props.description;
        updateMask.push("description");
      }

      if (props.labels !== undefined) {
        repositoryUpdate.labels = props.labels;
        updateMask.push("labels");
      }

      if (props.immutableTags !== undefined && format === "docker") {
        repositoryUpdate.dockerConfig = {
          immutableTags: props.immutableTags,
        };
        updateMask.push("docker_config.immutable_tags");
      }

      if (updateMask.length > 0) {
        const [operation] = await client.updateRepository({
          repository: repositoryUpdate,
          updateMask: { paths: updateMask },
        });
        repository = operation as typeof repository;
      } else {
        // No updates needed, fetch current state
        const [current] = await client.getRepository({ name: repositoryPath });
        repository = current;
      }

      logger.log(`  Repository ${name} updated`);
    } else {
      // Create new repository
      logger.log(`Creating repository: ${name}`);

      const repositoryResource = {
        format: format.toUpperCase() as
          | "DOCKER"
          | "MAVEN"
          | "NPM"
          | "PYTHON"
          | "APT"
          | "YUM"
          | "GO"
          | "KFP",
        description: undefined as string | undefined,
        labels: undefined as Record<string, string> | undefined,
        kmsKeyName: undefined as string | undefined,
        dockerConfig: undefined as { immutableTags?: boolean } | undefined,
      };

      if (props.description) {
        repositoryResource.description = props.description;
      }

      if (props.labels) {
        repositoryResource.labels = props.labels;
      }

      if (props.kmsKeyName) {
        repositoryResource.kmsKeyName = props.kmsKeyName;
      }

      if (props.immutableTags !== undefined && format === "docker") {
        repositoryResource.dockerConfig = {
          immutableTags: props.immutableTags,
        };
      }

      try {
        const [operation] = await client.createRepository({
          parent,
          repositoryId: name,
          repository: repositoryResource,
        });

        repository = (await operation.promise())[0];
        logger.log(`  Repository ${name} created`);
      } catch (error: unknown) {
        // Handle ALREADY_EXISTS error - adopt the existing repository
        if (isAlreadyExistsError(error)) {
          const adopt = props.adopt ?? this.scope.adopt;
          if (!adopt) {
            throw new Error(
              `Repository "${name}" already exists. Use adopt: true to adopt it.`,
              { cause: error },
            );
          }
          logger.log(`  Repository ${name} already exists, adopting`);
          const [existing] = await client.getRepository({
            name: repositoryPath,
          });
          repository = existing;
        } else {
          throw error;
        }
      }
    }

    // Build the host URL for Docker repositories
    const host =
      format === "docker"
        ? `${location}-docker.pkg.dev/${project}/${name}`
        : `${location}-${format}.pkg.dev/${project}/${name}`;

    return {
      name,
      location,
      project,
      format,
      description: props.description,
      labels: props.labels,
      immutableTags: props.immutableTags,
      kmsKeyName: props.kmsKeyName,
      resourceName: repository.name || repositoryPath,
      host,
      createTime: timestampToISOString(repository.createTime),
      updateTime: timestampToISOString(repository.updateTime),
      type: "google-cloud-artifact-registry",
    };
  },
);

/**
 * Convert Google Cloud timestamp to ISO string.
 */
function timestampToISOString(
  timestamp: { seconds?: number | Long | string | null } | null | undefined,
): string {
  if (!timestamp?.seconds) {
    return new Date().toISOString();
  }
  const seconds =
    typeof timestamp.seconds === "string"
      ? parseInt(timestamp.seconds, 10)
      : typeof timestamp.seconds === "object" && "toNumber" in timestamp.seconds
        ? (timestamp.seconds as Long).toNumber()
        : (timestamp.seconds as number);
  return new Date(seconds * 1000).toISOString();
}

/**
 * Long type for timestamp conversion.
 */
interface Long {
  toNumber(): number;
}
