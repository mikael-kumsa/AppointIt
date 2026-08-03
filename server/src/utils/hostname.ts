import net from "node:net";
import { domainToASCII } from "node:url";

export function normalizeHostname(input: string) {
  const value = input.trim().toLowerCase();
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    return null;
  }

  if (url.username || url.password || url.port || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
  const hostname = domainToASCII(url.hostname.replace(/\.$/, ""));
  if (!hostname || hostname.length > 253 || hostname === "localhost" || net.isIP(hostname)) return null;
  if (!hostname.includes(".") || hostname.split(".").some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return hostname;
}
