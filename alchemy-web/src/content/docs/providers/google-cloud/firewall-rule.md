---
title: FirewallRule
description: Create and manage Google Cloud VPC firewall rules
---

The `FirewallRule` resource creates and manages Google Cloud VPC firewall rules to control network traffic.

## Allow HTTP Traffic

```typescript
import { FirewallRule } from "alchemy/google-cloud";

const allowHttp = await FirewallRule("allow-http", {
  direction: "INGRESS",
  sourceRanges: ["0.0.0.0/0"],
  targetTags: ["http-server"],
  allowed: [{ protocol: "tcp", ports: ["80"] }],
});
```

## Allow HTTPS Traffic

```typescript
import { FirewallRule } from "alchemy/google-cloud";

const allowHttps = await FirewallRule("allow-https", {
  direction: "INGRESS",
  sourceRanges: ["0.0.0.0/0"],
  targetTags: ["https-server"],
  allowed: [{ protocol: "tcp", ports: ["443"] }],
  description: "Allow HTTPS traffic from anywhere",
});
```

## Allow SSH from Specific IP Range

```typescript
import { FirewallRule } from "alchemy/google-cloud";

const allowSsh = await FirewallRule("allow-ssh", {
  direction: "INGRESS",
  sourceRanges: ["10.0.0.0/8"],
  allowed: [{ protocol: "tcp", ports: ["22"] }],
  priority: 900,
});
```

## Multiple Ports and Protocols

```typescript
import { FirewallRule } from "alchemy/google-cloud";

const allowWeb = await FirewallRule("allow-web", {
  direction: "INGRESS",
  sourceRanges: ["0.0.0.0/0"],
  targetTags: ["web-server"],
  allowed: [
    { protocol: "tcp", ports: ["80", "443", "8080-8090"] },
    { protocol: "icmp" },
  ],
});
```

## Deny Traffic

```typescript
import { FirewallRule } from "alchemy/google-cloud";

const denyAll = await FirewallRule("deny-all-egress", {
  direction: "EGRESS",
  destinationRanges: ["0.0.0.0/0"],
  denied: [{ protocol: "all" }],
  priority: 65534,
});
```

## Properties

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `name` | `string` | `${app}-${stage}-${id}` | Firewall rule name |
| `network` | `string` | `"default"` | VPC network name |
| `direction` | `"INGRESS" \| "EGRESS"` | `"INGRESS"` | Traffic direction |
| `priority` | `number` | `1000` | Rule priority (0-65535, lower = higher priority) |
| `sourceRanges` | `string[]` | - | Source IP ranges (for INGRESS) |
| `destinationRanges` | `string[]` | - | Destination IP ranges (for EGRESS) |
| `sourceTags` | `string[]` | - | Source tags (for INGRESS) |
| `targetTags` | `string[]` | - | Target tags for rule application |
| `allowed` | `FirewallAllowed[]` | - | Traffic to allow |
| `denied` | `FirewallAllowed[]` | - | Traffic to deny |
| `description` | `string` | - | Rule description |
| `disabled` | `boolean` | `false` | Whether the rule is disabled |
| `adopt` | `boolean` | `false` | Adopt existing rule |

## FirewallAllowed

| Name | Type | Description |
|------|------|-------------|
| `protocol` | `string` | IP protocol ("tcp", "udp", "icmp", "all") |
| `ports` | `string[]` | Ports to allow (e.g., ["80", "443", "8080-8090"]) |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `selfLink` | `string` | Firewall rule self-link URL |
| `createdAt` | `string` | Creation timestamp |

## Using with Instances

Apply firewall rules to instances using network tags:

```typescript
import { FirewallRule, Instance } from "alchemy/google-cloud";

// Create firewall rule targeting "http-server" tag
await FirewallRule("allow-http", {
  sourceRanges: ["0.0.0.0/0"],
  targetTags: ["http-server"],
  allowed: [{ protocol: "tcp", ports: ["80"] }],
});

// Create instance with matching tag
const vm = await Instance("web-server", {
  zone: "us-central1-a",
  tags: ["http-server"], // Firewall rule applies to this instance
});
```

## Immutable Properties

These properties cannot be changed after creation and will trigger a replacement:

- `name`
- `network`
- `direction`
