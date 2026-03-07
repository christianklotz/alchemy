/**
 * Shared utility functions for Google Cloud resources.
 */

/**
 * Check if an error is a gRPC NOT_FOUND error (code 5) or HTTP 404.
 * Used for handling resources that have already been deleted.
 */
export function isNotFoundError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: number }).code;
    return code === 5 || code === 404; // gRPC NOT_FOUND or HTTP 404
  }
  return false;
}

/**
 * Check if an error is a gRPC ALREADY_EXISTS error (code 6) or HTTP 409.
 * Used for handling adoption of existing resources.
 */
export function isAlreadyExistsError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: number }).code;
    return code === 6 || code === 409; // gRPC ALREADY_EXISTS or HTTP 409
  }
  return false;
}

/**
 * Wait for a zone-scoped operation to complete.
 *
 * @param operationsClient - The ZoneOperationsClient instance
 * @param project - GCP project ID
 * @param zone - GCP zone
 * @param operationName - Name of the operation to wait for
 * @param maxAttempts - Maximum number of polling attempts (default: 60)
 * @param delayMs - Delay between polling attempts in milliseconds (default: 5000)
 */
export async function waitForZoneOperation(
  operationsClient: InstanceType<
    typeof import("@google-cloud/compute").ZoneOperationsClient
  >,
  project: string,
  zone: string,
  operationName: string,
  maxAttempts = 60,
  delayMs = 5000,
): Promise<void> {
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
 * Wait for a global operation to complete.
 *
 * @param operationsClient - The GlobalOperationsClient instance
 * @param project - GCP project ID
 * @param operationName - Name of the operation to wait for
 * @param maxAttempts - Maximum number of polling attempts (default: 60)
 * @param delayMs - Delay between polling attempts in milliseconds (default: 2000)
 */
export async function waitForGlobalOperation(
  operationsClient: InstanceType<
    typeof import("@google-cloud/compute").GlobalOperationsClient
  >,
  project: string,
  operationName: string,
  maxAttempts = 60,
  delayMs = 2000,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const [operation] = await operationsClient.get({
      project,
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
