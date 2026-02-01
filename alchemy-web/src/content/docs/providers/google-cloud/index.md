---
title: Google Cloud
description: Deploy and manage Google Cloud Platform resources with Alchemy
---

The Google Cloud provider enables Infrastructure-as-Code management for GCP resources including Compute Engine VMs, persistent disks, firewall rules, and Artifact Registry.

## Installation

Install the Google Cloud client libraries:

```bash
npm install @google-cloud/compute @google-cloud/artifact-registry
```

## Authentication

Set up authentication using one of these methods:

### Service Account Key (Recommended for CI/CD)

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
export GOOGLE_CLOUD_PROJECT="my-project-id"
```

### Application Default Credentials (Local Development)

```bash
gcloud auth application-default login
gcloud config set project my-project-id
```

## Resources

- [ArtifactRegistry](./artifact-registry) - Container and package registries
- [Disk](./disk) - Persistent disk storage
- [FirewallRule](./firewall-rule) - VPC firewall rules
- [Instance](./instance) - Compute Engine VM instances

## Example Usage

```typescript
import alchemy from "alchemy";
import { Instance, FirewallRule, Disk } from "alchemy/google-cloud";

const app = await alchemy("my-gcp-app");

// Create a firewall rule to allow HTTP traffic
const allowHttp = await FirewallRule("allow-http", {
  direction: "INGRESS",
  sourceRanges: ["0.0.0.0/0"],
  targetTags: ["http-server"],
  allowed: [{ protocol: "tcp", ports: ["80"] }],
});

// Create a data disk
const dataDisk = await Disk("data", {
  zone: "us-central1-a",
  sizeGb: 100,
  diskType: "pd-ssd",
});

// Create a VM instance with the disk attached
const vm = await Instance("web-server", {
  zone: "us-central1-a",
  machineType: "e2-medium",
  tags: ["http-server"],
  additionalDisks: [{ disk: dataDisk }],
});

console.log(`VM IP: ${vm.externalIp}`);

await app.finalize();
```

## Scope-Level Credentials

Configure credentials at the scope level for all resources:

```typescript
await alchemy.run("my-app", {
  googleCloud: {
    project: "my-project-id",
    keyFilename: "/path/to/credentials.json",
  },
}, async () => {
  // All Google Cloud resources inherit these credentials
  const vm = await Instance("server", {
    zone: "us-central1-a",
  });
});
```

## Container Deployments

Deploy containers to VMs using Container-Optimized OS:

```typescript
import { Instance, ArtifactRegistry } from "alchemy/google-cloud";
import { Image } from "alchemy/docker";

// Create a registry for your images
const registry = await ArtifactRegistry("images", {
  location: "us-central1",
  format: "docker",
});

// Build and push your container image
const image = await Image("my-app", {
  name: `${registry.host}/my-app`,
  tag: "latest",
  build: { context: "." },
});

// Deploy to a VM
const vm = await Instance("container-vm", {
  zone: "us-central1-a",
  machineType: "e2-small",
  container: {
    image,
    ports: [{ hostPort: 80, containerPort: 8080 }],
    env: { NODE_ENV: "production" },
  },
});
```
