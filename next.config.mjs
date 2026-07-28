/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    '/api/webhook': ['./src/lib/mercadolivre/generate-link.playwright.mjs'],
  },
};

export default nextConfig;
