# Google Cloud Provider

This provider enables Infrastructure-as-Code management for Google Cloud Platform (GCP) resources.

## Resources

| Resource | Description | Documentation |
|----------|-------------|---------------|
| [ArtifactRegistry](./artifact-registry.ts) | Container and package registry | [Artifact Registry Docs](https://cloud.google.com/artifact-registry/docs) |
| [Disk](./disk.ts) | Persistent disk storage | [Persistent Disk Docs](https://cloud.google.com/compute/docs/disks) |
| [FirewallRule](./firewall-rule.ts) | VPC firewall rules | [Firewall Rules Docs](https://cloud.google.com/vpc/docs/firewalls) |
| [Instance](./instance.ts) | Compute Engine VM instances | [Compute Engine Docs](https://cloud.google.com/compute/docs/instances) |

## Architecture

### Credential Resolution

Credentials are resolved using a three-tier system (lowest to highest priority):

1. **Global**: Environment variables (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`)
2. **Scope**: Scope-level `googleCloud` configuration
3. **Resource**: Resource-level props (`project`, `keyFilename`)

```ts
// Scope-level credentials
await alchemy.run("my-app", {
  googleCloud: {
    project: "my-project-id",
    keyFilename: "/path/to/service-account.json",
  },
}, async () => {
  // All resources inherit scope credentials
  const instance = await Instance("vm", { zone: "us-central1-a" });
});

// Resource-level override
const instance = await Instance("vm", {
  zone: "us-central1-a",
  project: "different-project", // Overrides scope/global
});
```

### Shared Utilities

Common utilities are extracted to [`util.ts`](./util.ts):

- `isNotFoundError(error)` - Check for gRPC NOT_FOUND (code 5) or HTTP 404
- `isAlreadyExistsError(error)` - Check for gRPC ALREADY_EXISTS (code 6) or HTTP 409
- `waitForZoneOperation(...)` - Wait for zone-scoped operations to complete
- `waitForGlobalOperation(...)` - Wait for global operations to complete

### Module Augmentation

The provider extends Alchemy's `ProviderCredentials` interface via module augmentation in [`client-props.ts`](./client-props.ts):

```ts
declare module "../scope.ts" {
  interface ProviderCredentials {
    googleCloud?: GoogleCloudClientProps;
  }
}
```

## Resource Patterns

### Data Resources (Safe Deletion)

Data resources (`Disk`, `ArtifactRegistry`) default to preserving data on deletion:

```ts
// Default: data is preserved when resource is removed from Alchemy
const disk = await Disk("data", { zone: "us-central1-a", sizeGb: 100 });

// Explicit deletion required
const disk = await Disk("data", { 
  zone: "us-central1-a", 
  sizeGb: 100,
  delete: true, // Actually delete the disk
});
```

### Compute Resources (Always Deleted)

Compute resources (`Instance`, `FirewallRule`) are always deleted when removed from Alchemy - no opt-out.

### Local Development Mode

All resources support local development mode (`this.scope.local`), returning mock data without making GCP API calls:

```ts
// When running with --dev or local: true
const instance = await Instance("vm", { zone: "us-central1-a" });
// Returns mock data with fake IPs, no GCP calls made
```

### Adoption Pattern

All resources support adopting existing resources:

```ts
const instance = await Instance("vm", {
  zone: "us-central1-a",
  adopt: true, // Adopt if already exists
});
```

### Immutable Properties

Properties that cannot be changed after creation trigger replacement via `this.replace()`:

| Resource | Immutable Properties |
|----------|---------------------|
| ArtifactRegistry | `name`, `location`, `format`, `kmsKeyName` |
| Disk | `name`, `zone`, `diskType` |
| FirewallRule | `name`, `network`, `direction` |
| Instance | `name`, `zone` |

## Dependencies

The provider uses Google Cloud client libraries as peer dependencies:

```json
{
  "@google-cloud/artifact-registry": "^3.0.0",
  "@google-cloud/compute": "^4.0.0"
}
```

These are dynamically imported to avoid requiring them when not using GCP resources.

## Container Support

The `Instance` resource supports deploying containers to VMs using Container-Optimized OS (COS):

```ts
const vm = await Instance("container-vm", {
  zone: "us-central1-a",
  container: {
    image: "nginx:alpine",
    ports: [{ hostPort: 80, containerPort: 80 }],
    env: { NGINX_HOST: "localhost" },
  },
});
```

This generates a startup script that:
1. Authenticates to Artifact Registry (if needed)
2. Pulls the container image
3. Runs the container with specified configuration

## Testing

Tests are located in `alchemy/test/google-cloud/` and require:

- `GOOGLE_CLOUD_PROJECT` environment variable
- `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service account key
- `ALL_TESTS=true` to enable (skipped by default due to cost/time)

```sh
ALL_TESTS=true bun vitest alchemy/test/google-cloud/
```

## Future Improvements

Potential resources to add:

- [ ] Cloud Storage Bucket
- [ ] Cloud SQL Instance
- [ ] Cloud Run Service
- [ ] Cloud Functions
- [ ] VPC Network
- [ ] Subnet
- [ ] Load Balancer
- [ ] Cloud DNS Zone/Record
- [ ] IAM Service Account
- [ ] Secret Manager Secret
