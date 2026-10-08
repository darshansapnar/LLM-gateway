import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Without this, Vite/Node on this machine binds only to the IPv6
    // loopback (::1) - "localhost" then fails to connect for any browser/
    // tool that resolves "localhost" to 127.0.0.1 first. Explicit host
    // forces a real IPv4 bind too.
    host: "127.0.0.1",
    strictPort: false,
  },
});
