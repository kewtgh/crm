import vinext from "vinext";
import { defineConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const nativeServerPackages = [
  "pg",
  "argon2",
  "@aws-sdk/client-s3",
  "@aws-sdk/s3-request-presigner",
];

export default defineConfig(async () => {
  return {
    environments: {
      rsc: { resolve: { external: nativeServerPackages } },
      ssr: { resolve: { external: nativeServerPackages } },
    },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
    ],
  };
});
