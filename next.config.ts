import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    /**
     * `NbaPlayerDoc.playerImageUrl` is the swap point for licensed player
     * imagery (BRD 7.4 - production must use a licensed provider and must
     * not be built around scraped images). next/image rejects any remote
     * host that isn't listed here with a 400, so the licensed provider's
     * host has to be added alongside its credentials.
     *
     * Nothing is listed yet because no provider is contracted: until one is,
     * PlayerCardImage renders a generated, deterministic card instead, which
     * is exactly what the BRD permits for the MVP/prototype.
     */
    remotePatterns: [],
  },
};

export default nextConfig;
