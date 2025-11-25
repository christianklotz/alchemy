import type { GoogleCloudClientProps } from "./client-props.ts";

/**
 * Get global Google Cloud configuration from environment variables.
 * This provides the base layer of credential configuration.
 */
export function getGlobalGoogleCloudConfig(): GoogleCloudClientProps {
  return {
    project:
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      undefined,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || undefined,
  };
}

/**
 * Resolve Google Cloud credentials using three-tier resolution: global -> scope -> resource.
 *
 * This function implements a comprehensive credential resolution system that allows
 * for flexible Google Cloud credential management across different levels of your application.
 *
 * The resolution follows this precedence order:
 * 1. Resource-level credentials (highest priority)
 * 2. Scope-level credentials (medium priority)
 * 3. Global environment variables (lowest priority)
 *
 * Supported credential properties include:
 * - `project`: GCP project ID
 * - `keyFilename`: Path to service account key JSON file
 *
 * @param resourceProps - Resource-level Google Cloud credential properties (optional)
 * @returns Resolved Google Cloud client properties
 *
 * @example
 * ```typescript
 * // Basic usage with resource-level credentials
 * const credentials = await resolveGoogleCloudCredentials({
 *   project: "my-project-id",
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Usage with scope-level credentials
 * await alchemy.run("my-app", {
 *   googleCloud: {
 *     project: "my-project-id",
 *   }
 * }, async () => {
 *   // Resources created here will use the scope credentials by default
 *   const instance = await Instance("web-server", {
 *     zone: "us-central1-a",
 *   });
 * });
 * ```
 */
export async function resolveGoogleCloudCredentials(
  resourceProps?: GoogleCloudClientProps,
): Promise<GoogleCloudClientProps> {
  // 1. Start with global environment variables (lowest priority)
  const globalConfig = getGlobalGoogleCloudConfig();

  // 2. Layer in scope-level credentials (medium priority)
  let scopeConfig: GoogleCloudClientProps = {};
  try {
    // Import Scope dynamically to avoid circular dependency
    const { Scope } = await import("../scope.ts");
    const currentScope = Scope.getScope();
    if (currentScope?.providerCredentials?.googleCloud) {
      scopeConfig = currentScope.providerCredentials.googleCloud;
    }
  } catch {
    // If we can't access scope (e.g., not running in scope context), just continue
    // with empty scope config
  }

  // 3. Layer in resource-level credentials (highest priority)
  const resourceConfig = resourceProps || {};

  // Merge configurations with proper precedence (later properties override earlier ones)
  const resolvedConfig = {
    ...globalConfig,
    ...scopeConfig,
    ...resourceConfig,
  };

  // Filter out undefined values from the final result
  return Object.fromEntries(
    Object.entries(resolvedConfig).filter(([_, value]) => value !== undefined),
  ) as GoogleCloudClientProps;
}
