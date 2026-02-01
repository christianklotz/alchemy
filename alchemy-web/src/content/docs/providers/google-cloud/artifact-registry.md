---
title: ArtifactRegistry
description: Create and manage Google Cloud Artifact Registry repositories
---

The `ArtifactRegistry` resource creates and manages Artifact Registry repositories for storing container images, language packages, and other artifacts.

## Create a Docker Repository

```typescript
import { ArtifactRegistry } from "alchemy/google-cloud";

const registry = await ArtifactRegistry("my-repo", {
  location: "us-central1",
  format: "docker",
});

console.log(registry.host); // us-central1-docker.pkg.dev/my-project/my-repo
```

## Repository with Immutable Tags

Create a Docker repository where tags cannot be moved or deleted:

```typescript
import { ArtifactRegistry } from "alchemy/google-cloud";

const registry = await ArtifactRegistry("prod-images", {
  location: "us-central1",
  format: "docker",
  immutableTags: true,
  description: "Production container images",
  labels: {
    environment: "production",
  },
});
```

## Use with Docker Image

Build and push an image to the repository:

```typescript
import { ArtifactRegistry } from "alchemy/google-cloud";
import { Image } from "alchemy/docker";

const registry = await ArtifactRegistry("app-images", {
  location: "us-central1",
});

const image = await Image("my-app", {
  name: `${registry.host}/my-app`,
  tag: "latest",
  build: { context: "." },
  registry: {
    server: "us-central1-docker.pkg.dev",
    username: "_json_key",
    password: alchemy.secret(serviceAccountKey),
  },
});
```

## NPM Package Repository

```typescript
import { ArtifactRegistry } from "alchemy/google-cloud";

const npmRegistry = await ArtifactRegistry("npm-packages", {
  location: "us-central1",
  format: "npm",
  description: "Internal NPM packages",
});
```

## Properties

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `location` | `string` | - | Region (e.g., "us-central1") |
| `name` | `string` | `${app}-${stage}-${id}` | Repository name |
| `format` | `RepositoryFormat` | `"docker"` | Repository format |
| `description` | `string` | - | Repository description |
| `labels` | `Record<string, string>` | - | Repository labels |
| `immutableTags` | `boolean` | `false` | Enable immutable tags (Docker only) |
| `kmsKeyName` | `string` | - | Cloud KMS key for encryption |
| `delete` | `boolean` | `false` | Delete repository when removed |
| `adopt` | `boolean` | `false` | Adopt existing repository |

## Repository Formats

| Format | Description |
|--------|-------------|
| `docker` | Container images |
| `maven` | Java packages |
| `npm` | Node.js packages |
| `python` | Python packages |
| `apt` | Debian packages |
| `yum` | RPM packages |
| `go` | Go modules |
| `kfp` | Kubeflow pipelines |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `name` | `string` | Repository name |
| `resourceName` | `string` | Full resource name |
| `host` | `string` | Registry host URL |
| `createTime` | `string` | Creation timestamp |
| `updateTime` | `string` | Last update timestamp |

## Data Safety

By default, repositories are **not deleted** when removed from Alchemy to protect your images and packages:

```typescript
// Default: repository data is preserved
const registry = await ArtifactRegistry("images", {
  location: "us-central1",
});

// Explicit deletion required
const registry = await ArtifactRegistry("temp-images", {
  location: "us-central1",
  delete: true, // Actually delete the repository
});
```

## Immutable Properties

These properties cannot be changed after creation and will trigger a replacement:

- `name`
- `location`
- `format`
- `kmsKeyName`
