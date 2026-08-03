import type { CSSProperties } from "react";

export type BookingThemeId = "cobalt" | "emerald" | "rose" | "amber" | "graphite";

export type BookingTheme = {
  id: BookingThemeId;
  name: string;
  description: string;
  colors: [string, string, string];
  variables: {
    brand: string;
    brandStrong: string;
    page: string;
    ink: string;
    muted: string;
    card: string;
    line: string;
    soft: string;
    shadow: string;
  };
};

export const bookingThemes: BookingTheme[] = [
  {
    id: "cobalt",
    name: "Cobalt",
    description: "Precise and trustworthy for clinics, consultants, and premium services.",
    colors: ["#2457a7", "#087a78", "#f4f7fb"],
    variables: { brand: "#2457a7", brandStrong: "#173c76", page: "#f4f7fb", ink: "#101d36", muted: "#52637a", card: "#ffffff", line: "#d7e0ec", soft: "#eef4fc", shadow: "rgba(16, 29, 54, 0.09)" }
  },
  {
    id: "emerald",
    name: "Emerald",
    description: "Calm and familiar for wellness, dental, spa, and care teams.",
    colors: ["#0f7b54", "#256b8c", "#f5f8f6"],
    variables: { brand: "#0f7b54", brandStrong: "#09583d", page: "#f5f8f6", ink: "#17211d", muted: "#637169", card: "#ffffff", line: "#d9e1dd", soft: "#eef7f2", shadow: "rgba(23, 45, 35, 0.09)" }
  },
  {
    id: "rose",
    name: "Rose",
    description: "Warm and polished for salons, beauty studios, and personal care.",
    colors: ["#b14569", "#7f4ca5", "#fff6f8"],
    variables: { brand: "#b14569", brandStrong: "#84314d", page: "#fff6f8", ink: "#2d1b25", muted: "#755d68", card: "#ffffff", line: "#ead6df", soft: "#fbeaf0", shadow: "rgba(91, 39, 62, 0.10)" }
  },
  {
    id: "amber",
    name: "Amber",
    description: "Energetic and approachable for barbers, studios, and local services.",
    colors: ["#b76512", "#226f68", "#fff8ee"],
    variables: { brand: "#b76512", brandStrong: "#834708", page: "#fff8ee", ink: "#2b2419", muted: "#6f6251", card: "#ffffff", line: "#eadcc8", soft: "#fff0d8", shadow: "rgba(91, 57, 19, 0.10)" }
  },
  {
    id: "graphite",
    name: "Graphite",
    description: "Quiet and executive for advisory, private clinics, and high-touch teams.",
    colors: ["#3d4a57", "#8a5d35", "#f6f6f4"],
    variables: { brand: "#3d4a57", brandStrong: "#27313b", page: "#f6f6f4", ink: "#1f252b", muted: "#626b73", card: "#ffffff", line: "#dcdedc", soft: "#ecefed", shadow: "rgba(31, 37, 43, 0.10)" }
  }
];

export function bookingThemeById(id?: string | null) {
  return bookingThemes.find((theme) => theme.id === id) ?? bookingThemes[0];
}

export function bookingThemeStyle(theme: BookingTheme) {
  return {
    "--brand": theme.variables.brand,
    "--brand-strong": theme.variables.brandStrong,
    "--primary": theme.variables.brand,
    "--accent": theme.variables.brand,
    "--ink": theme.variables.ink,
    "--muted": theme.variables.muted,
    "--line": theme.variables.line,
    "--surface": theme.variables.card,
    "--soft": theme.variables.soft,
    "--shadow": `0 14px 36px ${theme.variables.shadow}`,
    "--booking-page": theme.variables.page,
    "--booking-ink": theme.variables.ink,
    "--booking-muted": theme.variables.muted,
    "--booking-card": theme.variables.card,
    "--booking-line": theme.variables.line,
    "--booking-soft": theme.variables.soft,
    "--booking-shadow": theme.variables.shadow
  } as CSSProperties & Record<string, string>;
}
