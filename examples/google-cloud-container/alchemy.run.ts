import alchemy from "alchemy";
import { Image } from "alchemy/docker";
import { ArtifactRegistry, FirewallRule, Instance } from "alchemy/google-cloud";
import fs from "node:fs/promises";

const app = await alchemy("google-cloud-container");

// Configuration from environment
const zone = process.env.GOOGLE_CLOUD_ZONE ?? "us-central1-a";
const region = zone.split("-").slice(0, 2).join("-");

// Read service account credentials for Docker registry auth
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credentialsPath) {
  throw new Error(
    "GOOGLE_APPLICATION_CREDENTIALS environment variable is required",
  );
}
const credentials = await fs.readFile(credentialsPath, "utf-8");

// Create Artifact Registry repository for container images
const registry = await ArtifactRegistry("images", {
  location: region,
  format: "docker",
  adopt: true,
});

// Build and push the container image to Artifact Registry
const image = await Image("hello-server-image", {
  name: `${registry.host}/hello-server`,
  tag: "latest",
  build: {
    context: import.meta.dirname,
    dockerfile: "Dockerfile",
    platform: "linux/amd64",
  },
  registry: {
    server: `${region}-docker.pkg.dev`,
    username: "_json_key",
    password: alchemy.secret(credentials),
  },
});

// Create a firewall rule to allow HTTP traffic
await FirewallRule("allow-http", {
  direction: "INGRESS",
  sourceRanges: ["0.0.0.0/0"],
  targetTags: ["http-server"],
  allowed: [{ protocol: "tcp", ports: ["80"] }],
  description: "Allow HTTP traffic to instances with http-server tag",
});

// Deploy the container to a Google Cloud VM
const vm = await Instance("hello-server", {
  zone,
  machineType: "e2-micro",
  tags: ["http-server"],
  container: {
    image,
    ports: [{ hostPort: 80, containerPort: 8080 }],
  },
});

console.log(`VM External IP: ${vm.externalIp}`);
console.log(`URL: http://${vm.externalIp}/`);

await app.finalize();
