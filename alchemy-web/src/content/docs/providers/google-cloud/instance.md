---
title: Instance
description: Create and manage Google Cloud Compute Engine VM instances
---

The `Instance` resource creates and manages Google Cloud Compute Engine virtual machine instances.

## Minimal Example

```typescript
import { Instance } from "alchemy/google-cloud";

const vm = await Instance("web-server", {
  zone: "us-central1-a",
});

console.log(`External IP: ${vm.externalIp}`);
```

## Deploy a Container

Deploy a container to a VM using Container-Optimized OS:

```typescript
import { Instance } from "alchemy/google-cloud";

const vm = await Instance("container-vm", {
  zone: "us-central1-a",
  machineType: "e2-small",
  container: {
    image: "nginx:alpine",
    ports: [{ hostPort: 80, containerPort: 80 }],
    env: { NGINX_HOST: "localhost" },
  },
});
```

## Custom Configuration

```typescript
import { Instance } from "alchemy/google-cloud";

const vm = await Instance("app-server", {
  zone: "us-west1-b",
  machineType: "n1-standard-2",
  sourceImage: "projects/ubuntu-os-cloud/global/images/family/ubuntu-2204-lts",
  diskSizeGb: 50,
  diskType: "pd-ssd",
  assignExternalIp: true,
  startupScript: `#!/bin/bash
    apt-get update
    apt-get install -y nginx
  `,
  labels: {
    environment: "production",
    team: "backend",
  },
  tags: ["http-server", "https-server"],
});
```

## Attach Additional Disks

```typescript
import { Instance, Disk } from "alchemy/google-cloud";

const dataDisk = await Disk("data", {
  zone: "us-central1-a",
  sizeGb: 200,
  diskType: "pd-balanced",
});

const vm = await Instance("server", {
  zone: "us-central1-a",
  machineType: "e2-medium",
  additionalDisks: [{
    disk: dataDisk,
    deviceName: "data-disk",
    mode: "READ_WRITE",
  }],
});
```

## Properties

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `zone` | `string` | - | GCP zone (e.g., "us-central1-a") |
| `name` | `string` | `${app}-${stage}-${id}` | Instance name |
| `machineType` | `string` | `"e2-medium"` | Machine type |
| `sourceImage` | `string` | Debian 11 | Boot disk source image |
| `diskSizeGb` | `number` | `10` | Boot disk size in GB |
| `diskType` | `"pd-standard" \| "pd-balanced" \| "pd-ssd"` | `"pd-standard"` | Boot disk type |
| `network` | `string` | `"default"` | VPC network name |
| `assignExternalIp` | `boolean` | `true` | Assign external IP |
| `startupScript` | `string` | - | Script to run on boot |
| `labels` | `Record<string, string>` | - | Instance labels |
| `tags` | `string[]` | - | Network tags for firewall rules |
| `container` | `ContainerConfig` | - | Container to deploy |
| `additionalDisks` | `AttachedDiskConfig[]` | - | Additional disks to attach |
| `serviceAccountScopes` | `string[]` | varies | Service account scopes |
| `adopt` | `boolean` | `false` | Adopt existing instance |

## Container Configuration

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `image` | `string \| Image` | - | Container image |
| `ports` | `ContainerPortMapping[]` | - | Port mappings |
| `env` | `Record<string, string>` | - | Environment variables |
| `volumes` | `ContainerVolumeMount[]` | - | Volume mounts |
| `restartPolicy` | `"always" \| "on-failure" \| "no"` | `"always"` | Restart policy |
| `command` | `string[]` | - | Override command |
| `privileged` | `boolean` | `false` | Privileged mode |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `selfLink` | `string` | Instance self-link URL |
| `status` | `string` | Instance status |
| `internalIp` | `string` | Internal IP address |
| `externalIp` | `string` | External IP address (if assigned) |
| `createdAt` | `string` | Creation timestamp |
