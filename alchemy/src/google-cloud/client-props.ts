/**
 * Common properties for Google Cloud client configuration.
 * These can be specified at the global, scope, or resource level.
 */
export interface GoogleCloudClientProps {
  /**
   * GCP Project ID.
   * @default process.env.GOOGLE_CLOUD_PROJECT or process.env.GCLOUD_PROJECT
   */
  project?: string;

  /**
   * Path to service account key JSON file.
   * @default process.env.GOOGLE_APPLICATION_CREDENTIALS
   */
  keyFilename?: string;
}

/**
 * Google Cloud scope extensions - adds Google Cloud credential support to scope options.
 * This uses TypeScript module augmentation to extend the ProviderCredentials interface.
 * Since ScopeOptions and RunOptions both extend ProviderCredentials,
 * they automatically inherit these properties.
 */
declare module "../scope.ts" {
  interface ProviderCredentials {
    /**
     * Google Cloud credentials configuration for this scope.
     * All Google Cloud resources created within this scope will inherit these credentials
     * unless overridden at the resource level.
     */
    googleCloud?: GoogleCloudClientProps;
  }
}
