function normalizeBasePath(value: string | undefined): string {
  if (!value) return "";
  if (value === "/") return "";
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

export const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

export function withBasePath(path: string): string {
  if (!basePath) return path;
  if (!path) return basePath;
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith(basePath)) return path;
  return path.startsWith("/") ? `${basePath}${path}` : `${basePath}/${path}`;
}
