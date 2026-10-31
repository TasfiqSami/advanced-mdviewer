import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const deploymentDir = join(root, "hosting-ready");
const archivePath = join(root, "SYXLOR-MD-VIEWER-HOSTING-READY.zip");
const requiredBuilds = [join(root, "dist", "index.html"), join(root, "server-build", "index.js")];

for (const path of requiredBuilds) {
  try {
    await stat(path);
  } catch {
    throw new Error(`Missing production build output: ${relative(root, path)}. Run npm run build first.`);
  }
}

await rm(deploymentDir, { recursive: true, force: true });
await mkdir(deploymentDir, { recursive: true });

for (const directory of ["dist", "server-build", "server", "src", "public", "scripts"]) {
  await cp(join(root, directory), join(deploymentDir, directory), { recursive: true });
}
for (const file of [
  ".env.example",
  "DEPLOYMENT.md",
  "README.md",
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.server.json",
  "tsconfig.server.build.json",
  "vite.config.ts",
]) {
  await cp(join(root, file), join(deploymentDir, file));
}

const archive = new JSZip();
async function addDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await addDirectory(absolutePath);
    } else if (entry.isFile()) {
      const archiveName = relative(deploymentDir, absolutePath).split(sep).join("/");
      archive.file(archiveName, await readFile(absolutePath));
    }
  }
}
await addDirectory(deploymentDir);
const archiveBuffer = await archive.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 6 },
});
await mkdir(dirname(archivePath), { recursive: true });
await writeFile(archivePath, archiveBuffer);

console.log(`Hosting package created at ${deploymentDir}`);
console.log(`Hosting archive created at ${archivePath}`);
