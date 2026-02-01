import type { protos } from "@google-cloud/compute";
import type { Context } from "../context.ts";
import { Resource, ResourceKind } from "../resource.ts";
import { logger } from "../util/logger.ts";
import type { GoogleCloudClientProps } from "./client-props.ts";
import { resolveGoogleCloudCredentials } from "./credentials.ts";
import {
  isAlreadyExistsError,
  isNotFoundError,
  waitForGlobalOperation,
} from "./util.ts";

/**
 * Firewall rule direction.
 */
export type FirewallDirection = "INGRESS" | "EGRESS";

/**
 * Firewall rule action.
 */
export type FirewallAction = "ALLOW" | "DENY";

/**
 * Allowed traffic specification.
 */
export interface FirewallAllowed {
  /**
   * IP protocol (e.g., "tcp", "udp", "icmp", "all").
   */
  protocol: string;

  /**
   * Ports to allow (e.g., ["80", "443", "8080-8090"]).
   * Only applicable for tcp and udp protocols.
   */
  ports?: string[];
}

/**
 * Properties for creating or updating a Google Cloud firewall rule.
 */
export interface FirewallRuleProps extends GoogleCloudClientProps {
  /**
   * Name of the firewall rule.
   * @default ${app}-${stage}-${id}
   */
  name?: string;

  /**
   * Network to apply the firewall rule to.
   * @default "default"
   */
  network?: string;

  /**
   * Direction of traffic to match.
   * @default "INGRESS"
   */
  direction?: FirewallDirection;

  /**
   * Priority of the rule (0-65535, lower = higher priority).
   * @default 1000
   */
  priority?: number;

  /**
   * Source IP ranges for INGRESS rules.
   * Use ["0.0.0.0/0"] to allow from anywhere.
   */
  sourceRanges?: string[];

  /**
   * Destination IP ranges for EGRESS rules.
   */
  destinationRanges?: string[];

  /**
   * Source tags for INGRESS rules.
   */
  sourceTags?: string[];

  /**
   * Target tags - instances with these tags will have this rule applied.
   */
  targetTags?: string[];

  /**
   * Traffic to allow.
   */
  allowed?: FirewallAllowed[];

  /**
   * Traffic to deny.
   */
  denied?: FirewallAllowed[];

  /**
   * Description of the firewall rule.
   */
  description?: string;

  /**
   * Whether the firewall rule is disabled.
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether to adopt an existing firewall rule if it already exists.
   * @default false
   */
  adopt?: boolean;
}

/**
 * Output type for a Google Cloud firewall rule.
 */
export type FirewallRule = Omit<FirewallRuleProps, "keyFilename" | "adopt"> & {
  /**
   * The firewall rule name.
   */
  name: string;

  /**
   * The firewall rule self-link URL.
   */
  selfLink: string;

  /**
   * Creation timestamp.
   */
  createdAt: string;

  /**
   * Resource type identifier.
   */
  type: "google-cloud-firewall-rule";
};

/**
 * Type guard for FirewallRule resource.
 */
export function isFirewallRule(resource: unknown): resource is FirewallRule {
  return (
    typeof resource === "object" &&
    resource !== null &&
    (resource as any)[ResourceKind] === "google-cloud::FirewallRule"
  );
}

/**
 * Google Cloud Firewall Rule Resource
 *
 * Creates and manages Google Cloud VPC firewall rules.
 *
 * @example
 * ## Allow HTTP traffic
 *
 * Creates a firewall rule allowing HTTP traffic to instances with the "http-server" tag.
 *
 * ```ts
 * import { FirewallRule } from "alchemy/google-cloud";
 *
 * const allowHttp = await FirewallRule("allow-http", {
 *   direction: "INGRESS",
 *   sourceRanges: ["0.0.0.0/0"],
 *   targetTags: ["http-server"],
 *   allowed: [{ protocol: "tcp", ports: ["80"] }],
 * });
 * ```
 *
 * @example
 * ## Allow HTTPS traffic
 *
 * Creates a firewall rule allowing HTTPS traffic.
 *
 * ```ts
 * import { FirewallRule } from "alchemy/google-cloud";
 *
 * const allowHttps = await FirewallRule("allow-https", {
 *   direction: "INGRESS",
 *   sourceRanges: ["0.0.0.0/0"],
 *   targetTags: ["https-server"],
 *   allowed: [{ protocol: "tcp", ports: ["443"] }],
 *   description: "Allow HTTPS traffic from anywhere",
 * });
 * ```
 *
 * @example
 * ## Allow SSH from specific IP range
 *
 * Creates a firewall rule allowing SSH from a specific IP range.
 *
 * ```ts
 * import { FirewallRule } from "alchemy/google-cloud";
 *
 * const allowSsh = await FirewallRule("allow-ssh", {
 *   direction: "INGRESS",
 *   sourceRanges: ["10.0.0.0/8"],
 *   allowed: [{ protocol: "tcp", ports: ["22"] }],
 *   priority: 900,
 * });
 * ```
 */
export const FirewallRule = Resource(
  "google-cloud::FirewallRule",
  async function (
    this: Context<FirewallRule>,
    id: string,
    props: FirewallRuleProps,
  ): Promise<FirewallRule> {
    // Resolve credentials
    const credentials = await resolveGoogleCloudCredentials(props);
    const project = credentials.project;

    if (!project) {
      throw new Error(
        "Google Cloud project is required. Set GOOGLE_CLOUD_PROJECT environment variable or pass project in props.",
      );
    }

    // Generate firewall rule name
    const name =
      props.name ?? this.output?.name ?? this.scope.createPhysicalName(id);
    const network = props.network ?? "default";
    const direction = props.direction ?? "INGRESS";
    const priority = props.priority ?? 1000;

    // Local development mode - return mock data
    if (this.scope.local) {
      return {
        name,
        project,
        network,
        direction,
        priority,
        sourceRanges: props.sourceRanges,
        destinationRanges: props.destinationRanges,
        sourceTags: props.sourceTags,
        targetTags: props.targetTags,
        allowed: props.allowed,
        denied: props.denied,
        description: props.description,
        disabled: props.disabled,
        selfLink:
          this.output?.selfLink ??
          `https://www.googleapis.com/compute/v1/projects/${project}/global/firewalls/${name}`,
        createdAt: this.output?.createdAt ?? new Date().toISOString(),
        type: "google-cloud-firewall-rule",
      };
    }

    // Import the compute client dynamically
    const { FirewallsClient, GlobalOperationsClient } =
      await import("@google-cloud/compute");

    // Create clients with resolved credentials
    const clientOptions: { projectId?: string; keyFilename?: string } = {};
    if (credentials.project) {
      clientOptions.projectId = credentials.project;
    }
    if (credentials.keyFilename) {
      clientOptions.keyFilename = credentials.keyFilename;
    }

    const firewallsClient = new FirewallsClient(clientOptions);
    const operationsClient = new GlobalOperationsClient(clientOptions);

    if (this.phase === "delete") {
      if (this.output?.name) {
        logger.log(`Deleting firewall rule: ${this.output.name}`);

        try {
          const [operation] = await firewallsClient.delete({
            project,
            firewall: this.output.name,
          });

          if (operation.name) {
            await waitForGlobalOperation(
              operationsClient,
              project,
              operation.name,
            );
          }

          logger.log(`  Firewall rule ${this.output.name} deleted`);
        } catch (error: unknown) {
          if (isNotFoundError(error)) {
            logger.log(`  Firewall rule ${this.output.name} already deleted`);
          } else {
            throw error;
          }
        }
      }
      return this.destroy();
    }

    // Check for immutable property changes during update
    if (this.phase === "update" && this.output) {
      if (this.output.name !== name) {
        logger.log(
          `Name changed from ${this.output.name} to ${name}, replacing firewall rule`,
        );
        return this.replace();
      }
      if (this.output.network !== network) {
        logger.log(
          `Network changed from ${this.output.network} to ${network}, replacing firewall rule`,
        );
        return this.replace();
      }
      if (this.output.direction !== direction) {
        logger.log(
          `Direction changed from ${this.output.direction} to ${direction}, replacing firewall rule`,
        );
        return this.replace();
      }
    }

    // Build the firewall resource
    const firewallResource: protos.google.cloud.compute.v1.IFirewall = {
      name,
      network: `global/networks/${network}`,
      direction,
      priority,
      description: props.description,
      disabled: props.disabled ?? false,
    };

    if (props.sourceRanges) {
      firewallResource.sourceRanges = props.sourceRanges;
    }

    if (props.destinationRanges) {
      firewallResource.destinationRanges = props.destinationRanges;
    }

    if (props.sourceTags) {
      firewallResource.sourceTags = props.sourceTags;
    }

    if (props.targetTags) {
      firewallResource.targetTags = props.targetTags;
    }

    if (props.allowed) {
      firewallResource.allowed = props.allowed.map((a) => ({
        IPProtocol: a.protocol,
        ports: a.ports,
      }));
    }

    if (props.denied) {
      firewallResource.denied = props.denied.map((d) => ({
        IPProtocol: d.protocol,
        ports: d.ports,
      }));
    }

    let firewall: protos.google.cloud.compute.v1.IFirewall;

    if (this.phase === "update" && this.output?.name) {
      // Update existing firewall rule
      logger.log(`Updating firewall rule: ${name}`);

      const [operation] = await firewallsClient.update({
        project,
        firewall: name,
        firewallResource,
      });

      if (operation.name) {
        await waitForGlobalOperation(operationsClient, project, operation.name);
      }

      const [updated] = await firewallsClient.get({
        project,
        firewall: name,
      });
      firewall = updated;

      logger.log(`  Firewall rule ${name} updated`);
    } else {
      // Create new firewall rule
      logger.log(`Creating firewall rule: ${name}`);

      try {
        const [operation] = await firewallsClient.insert({
          project,
          firewallResource,
        });

        if (operation.name) {
          await waitForGlobalOperation(
            operationsClient,
            project,
            operation.name,
          );
        }

        const [created] = await firewallsClient.get({
          project,
          firewall: name,
        });
        firewall = created;

        logger.log(`  Firewall rule ${name} created`);
      } catch (error: unknown) {
        if (isAlreadyExistsError(error)) {
          const adopt = props.adopt ?? this.scope.adopt;
          if (!adopt) {
            throw new Error(
              `Firewall rule "${name}" already exists. Use adopt: true to adopt it.`,
              { cause: error },
            );
          }
          logger.log(`  Firewall rule ${name} already exists, adopting`);
          const [existing] = await firewallsClient.get({
            project,
            firewall: name,
          });
          firewall = existing;
        } else {
          throw error;
        }
      }
    }

    return {
      name,
      project,
      network,
      direction,
      priority,
      sourceRanges: props.sourceRanges,
      destinationRanges: props.destinationRanges,
      sourceTags: props.sourceTags,
      targetTags: props.targetTags,
      allowed: props.allowed,
      denied: props.denied,
      description: props.description,
      disabled: props.disabled,
      selfLink: firewall.selfLink || "",
      createdAt: firewall.creationTimestamp || new Date().toISOString(),
      type: "google-cloud-firewall-rule",
    };
  },
);
