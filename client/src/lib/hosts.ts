const platformHosts = new Set(
  (import.meta.env.VITE_PLATFORM_HOSTS ?? "localhost,127.0.0.1")
    .split(",")
    .map((value: string) => value.trim().toLowerCase())
    .filter(Boolean)
);

export function isCustomBookingHost(hostname = location.hostname) {
  return !platformHosts.has(hostname.toLowerCase());
}
