import type { ReactNode } from "react";

export function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="feature">{icon}<strong>{title}</strong><span>{text}</span></div>;
}

export function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

export function StatusRow({ icon, label, status }: { icon: ReactNode; label: string; status: string }) {
  return <div className="status-row">{icon}<span>{label}</span><strong>{status}</strong></div>;
}
