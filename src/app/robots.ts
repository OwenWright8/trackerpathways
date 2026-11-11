import type { MetadataRoute } from "next";

// Self-hosted instances shouldn't be indexed by search engines.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
