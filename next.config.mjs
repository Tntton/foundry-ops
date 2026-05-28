/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Default is 1 MB. Intake drop-zone sends base64-encoded receipts /
    // invoices to the OCR action — a 5 MB photo inflates to ~7 MB after
    // base64, so give us a 12 MB ceiling to cover most phone uploads.
    serverActions: { bodySizeLimit: '12mb' },
  },
};

export default nextConfig;
