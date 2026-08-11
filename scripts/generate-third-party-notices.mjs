import { readFile, writeFile } from "node:fs/promises";

const lockfile = JSON.parse(await readFile("package-lock.json", "utf8"));
const packages = new Map();

for (const [path, metadata] of Object.entries(lockfile.packages ?? {})) {
  const packageName = metadata.name ?? path.split("node_modules/").at(-1);
  if (!path || metadata.dev || !packageName || !metadata.version) {
    continue;
  }

  const repository =
    typeof metadata.repository === "string"
      ? metadata.repository
      : metadata.repository?.url;
  const url = metadata.homepage ?? repository;
  const normalizedUrl = url
    ?.replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
  const license = Array.isArray(metadata.license)
    ? metadata.license.join(" OR ")
    : (metadata.license ?? "UNKNOWN");

  packages.set(`${packageName}@${metadata.version}`, {
    license,
    url: normalizedUrl,
  });
}

const lines = [
  "# Third-Party Notices",
  "",
  "This application includes the following production dependencies. License details are taken from package-lock.json.",
  "",
];

for (const [name, metadata] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const label = metadata.url ? `[${name}](${metadata.url})` : name;
  lines.push(`- ${label} — ${metadata.license}`);
}

lines.push("");
await writeFile("THIRD-PARTY-NOTICES.md", lines.join("\n"));
