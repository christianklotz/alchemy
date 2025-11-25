# Google Cloud Provider

This provider implements resources for Google Cloud Platform (GCP).

## Resources

- [Instance](./instance.ts) - Compute Engine VM instances

## Authentication

The Google Cloud provider uses Application Default Credentials (ADC) for authentication. Credentials are resolved in the following order:

1. **Resource-level** - Explicit `project` and `keyFilename` in resource props
2. **Scope-level** - `googleCloud` credentials in `alchemy.run()` options
3. **Global** - Environment variables:
   - `GOOGLE_CLOUD_PROJECT` or `GCLOUD_PROJECT` - GCP project ID
   - `GOOGLE_APPLICATION_CREDENTIALS` - Path to service account key JSON file

### Local Development

For local development, you can use:

```bash
# Option 1: Use gcloud CLI (recommended for development)
gcloud auth application-default login

# Option 2: Set environment variable to service account key
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
export GOOGLE_CLOUD_PROJECT=my-project-id
```

### Service Account Key

For production, create a service account with the necessary permissions and download the JSON key:

1. Go to [GCP Console > IAM & Admin > Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Create a new service account or select existing
3. Grant required roles (e.g., `Compute Instance Admin (v1)`)
4. Create a key and download the JSON file
5. Set `GOOGLE_APPLICATION_CREDENTIALS` to the path of the JSON file

## Usage

### Basic Usage

```typescript
import { Instance } from "alchemy/google-cloud";

const vm = await Instance("web-server", {
  zone: "us-central1-a",
  machineType: "e2-medium",
});

console.log(vm.externalIp);
```

### With Scope-Level Credentials

```typescript
import alchemy from "alchemy";
import { Instance } from "alchemy/google-cloud";

await alchemy.run("my-app", {
  googleCloud: {
    project: "my-gcp-project",
  },
}, async () => {
  const vm = await Instance("web-server", {
    zone: "us-central1-a",
  });
});
```

### With Resource-Level Credentials

```typescript
import { Instance } from "alchemy/google-cloud";

const vm = await Instance("web-server", {
  project: "my-gcp-project",
  keyFilename: "/path/to/service-account.json",
  zone: "us-central1-a",
});
```

## Instance Resource

Creates and manages Google Cloud Compute Engine VM instances.

### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `zone` | `string` | required | Zone for the instance (e.g., "us-central1-a") |
| `name` | `string` | `${app}-${stage}-${id}` | Instance name |
| `machineType` | `string` | `"e2-medium"` | Machine type |
| `sourceImage` | `string` | `"projects/debian-cloud/global/images/family/debian-11"` | Boot disk image (ignored if `container` is set) |
| `diskSizeGb` | `number` | `10` | Boot disk size in GB |
| `diskType` | `"pd-standard" \| "pd-balanced" \| "pd-ssd"` | `"pd-standard"` | Boot disk type |
| `network` | `string` | `"default"` | Network name |
| `assignExternalIp` | `boolean` | `true` | Whether to assign external IP |
| `startupScript` | `string` | - | Startup script to run on boot (ignored if `container` is set) |
| `labels` | `Record<string, string>` | - | Labels to apply |
| `tags` | `string[]` | - | Tags for firewall rules |
| `container` | `ContainerConfig` | - | Container configuration (uses Container-Optimized OS) |
| `project` | `string` | from ADC | GCP project ID |
| `keyFilename` | `string` | from ADC | Path to service account key JSON |

### Container Configuration

When `container` is specified, the instance uses Container-Optimized OS and runs a container via Docker.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `image` | `Image \| string` | required | Container image (Alchemy Image or string like "nginx:alpine") |
| `env` | `Record<string, string>` | - | Environment variables |
| `ports` | `ContainerPortMapping[]` | - | Port mappings from host to container |
| `volumes` | `ContainerVolumeMount[]` | - | Volume mounts from host to container |
| `restartPolicy` | `"always" \| "on-failure" \| "no"` | `"always"` | Container restart policy |
| `command` | `string[]` | - | Override container command |
| `privileged` | `boolean` | `false` | Run in privileged mode |

#### Example: Deploy nginx container

```typescript
import { Instance } from "alchemy/google-cloud";

const vm = await Instance("web-server", {
  zone: "us-central1-a",
  machineType: "e2-small",
  container: {
    image: "nginx:alpine",
    ports: [{ hostPort: 80, containerPort: 80 }],
    env: { NGINX_HOST: "example.com" },
  },
});
```

#### Example: Deploy with Alchemy Image resource

```typescript
import { Instance } from "alchemy/google-cloud";
import { Image } from "alchemy/docker";

// Build and push image to Artifact Registry
const image = await Image("my-app", {
  name: "us-central1-docker.pkg.dev/my-project/my-repo/my-app",
  tag: "latest",
  build: { context: "./app" },
  registry: {
    server: "us-central1-docker.pkg.dev",
    username: "_json_key",
    password: alchemy.secret.env.GOOGLE_CREDENTIALS_JSON,
  },
});

// Deploy container to GCE VM
const vm = await Instance("app-server", {
  zone: "us-central1-a",
  machineType: "e2-small",
  container: {
    image,
    ports: [{ hostPort: 80, containerPort: 8080 }],
    restartPolicy: "always",
  },
});
```

### Output

| Property | Type | Description |
|----------|------|-------------|
| `selfLink` | `string` | Instance self-link URL |
| `status` | `string` | Instance status (e.g., "RUNNING") |
| `internalIp` | `string` | Internal IP address |
| `externalIp` | `string` | External IP address (if assigned) |
| `createdAt` | `string` | Creation timestamp |
| `container` | `ResolvedContainerConfig` | Container config with resolved imageRef |

### Immutable Properties

The following properties cannot be changed after creation and will trigger instance replacement:

- `zone`
- `name`
- `container.image` (container image change requires replacement)
- Adding or removing `container` configuration

### Mutable Properties

The following properties can be updated in-place:

- `labels`
- `tags`

## Dependencies

This provider requires the `@google-cloud/compute` package as a peer dependency:

```bash
npm install @google-cloud/compute
```

## Testing

To run tests, you need:

1. A GCP project with the Compute Engine API enabled
2. A service account with `Compute Instance Admin (v1)` role
3. Environment variables set:

```bash
export GOOGLE_CLOUD_PROJECT=my-project-id
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
export ALL_TESTS=true

bun vitest run ./alchemy/test/google-cloud
```
