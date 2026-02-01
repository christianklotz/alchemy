---
title: Disk
description: Create and manage Google Cloud Persistent Disks
---

The `Disk` resource creates and manages Google Cloud persistent disks that can be attached to VM instances.

## Minimal Example

```typescript
import { Disk } from "alchemy/google-cloud";

const disk = await Disk("data-disk", {
  zone: "us-central1-a",
  sizeGb: 100,
});
```

## SSD Disk with Labels

```typescript
import { Disk } from "alchemy/google-cloud";

const disk = await Disk("fast-storage", {
  zone: "us-west1-b",
  sizeGb: 500,
  diskType: "pd-ssd",
  labels: {
    environment: "production",
    team: "backend",
  },
});
```

## Create from Snapshot

```typescript
import { Disk } from "alchemy/google-cloud";

const disk = await Disk("restored-disk", {
  zone: "us-central1-a",
  sizeGb: 100,
  sourceSnapshot: "projects/my-project/global/snapshots/my-snapshot",
});
```

## Attach to Instance

```typescript
import { Disk, Instance } from "alchemy/google-cloud";

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
  }],
});
```

## Properties

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `zone` | `string` | - | GCP zone (e.g., "us-central1-a") |
| `sizeGb` | `number` | - | Disk size in GB (10-65536) |
| `name` | `string` | `${app}-${stage}-${id}` | Disk name |
| `diskType` | `"pd-standard" \| "pd-balanced" \| "pd-ssd" \| "pd-extreme"` | `"pd-standard"` | Disk type |
| `sourceImage` | `string` | - | Source image (mutually exclusive with sourceSnapshot) |
| `sourceSnapshot` | `string` | - | Source snapshot (mutually exclusive with sourceImage) |
| `labels` | `Record<string, string>` | - | Disk labels |
| `delete` | `boolean` | `false` | Delete disk when removed from Alchemy |
| `adopt` | `boolean` | `false` | Adopt existing disk |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `selfLink` | `string` | Disk self-link URL |
| `status` | `"CREATING" \| "RESTORING" \| "FAILED" \| "READY" \| "DELETING"` | Disk status |
| `createdAt` | `string` | Creation timestamp |

## Data Safety

By default, disks are **not deleted** when removed from Alchemy to protect your data:

```typescript
// Default: disk data is preserved
const disk = await Disk("important-data", {
  zone: "us-central1-a",
  sizeGb: 100,
});

// Explicit deletion required
const disk = await Disk("temporary-data", {
  zone: "us-central1-a",
  sizeGb: 100,
  delete: true, // Actually delete the disk
});
```

## Immutable Properties

These properties cannot be changed after creation and will trigger a replacement:

- `zone`
- `name`
- `diskType`

Disk size can only be increased, not decreased.
