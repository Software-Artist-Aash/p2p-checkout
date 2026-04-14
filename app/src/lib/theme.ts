/**
 * Design tokens — restraint, single accent, Stripe-like.
 */

export const color = {
  // Surfaces
  bg: "#fafafa",
  surface: "#ffffff",
  surfaceAlt: "#f5f5f5",
  // Borders (hairline)
  border: "#eaeaea",
  borderStrong: "#d4d4d4",
  // Text
  text: "#0a0b0d",
  textMuted: "#6b6b6b",
  textFaint: "#9a9a9a",
  // Brand
  accent: "#7c3aed",
  accentText: "#ffffff",
  accentSoft: "#f3efff",
  // Status
  success: "#0f9b53",
  successSoft: "#e9f8ef",
  warning: "#b5750a",
  warningSoft: "#fef4e2",
  danger: "#d12f2f",
  dangerSoft: "#fdecec",
  info: "#2563eb",
  infoSoft: "#eaf1ff",
};

export const radius = {
  sm: "6px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  pill: "999px",
};

export const shadow = {
  none: "none",
  sm: "0 1px 2px rgba(0,0,0,0.04)",
  card: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)",
  pop: "0 4px 16px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
  focus: `0 0 0 3px ${color.accent}33`,
};

export const space = {
  "0": "0",
  "1": "4px",
  "2": "8px",
  "3": "12px",
  "4": "16px",
  "5": "20px",
  "6": "24px",
  "8": "32px",
  "10": "40px",
  "12": "48px",
};

export const font = {
  xs: "11px",
  sm: "12px",
  md: "13px",
  base: "14px",
  lg: "16px",
  xl: "18px",
  xxl: "22px",
  display: "28px",
  hero: "36px",
};

export const weight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

export const layout = {
  cardWidth: 440,
  pageMaxWidth: 960,
};

// Utility: inline-style builder with our tokens
export const S = {
  // Surfaces
  pageBg: { background: color.bg },
  card: {
    background: color.surface,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    boxShadow: shadow.card,
  } as React.CSSProperties,
  cardFlat: {
    background: color.surface,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
  } as React.CSSProperties,

  // Typography
  h1: { fontSize: font.display, fontWeight: weight.bold, margin: 0, letterSpacing: "-0.02em" } as React.CSSProperties,
  h2: { fontSize: font.xxl, fontWeight: weight.semibold, margin: 0, letterSpacing: "-0.01em" } as React.CSSProperties,
  h3: { fontSize: font.lg, fontWeight: weight.semibold, margin: 0 } as React.CSSProperties,
  label: {
    fontSize: font.xs,
    fontWeight: weight.medium,
    color: color.textMuted,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  } as React.CSSProperties,
  body: { fontSize: font.base, color: color.text } as React.CSSProperties,
  muted: { fontSize: font.md, color: color.textMuted } as React.CSSProperties,
  faint: { fontSize: font.sm, color: color.textFaint } as React.CSSProperties,
  mono: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: font.md,
  } as React.CSSProperties,
  num: { fontVariantNumeric: "tabular-nums" } as React.CSSProperties,

  // Controls
  primaryBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    width: "100%",
    height: "46px",
    padding: "0 16px",
    background: color.accent,
    color: color.accentText,
    border: "none",
    borderRadius: radius.md,
    fontSize: font.base,
    fontWeight: weight.semibold,
    cursor: "pointer",
    transition: "opacity 120ms, transform 120ms",
  } as React.CSSProperties,

  secondaryBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    height: "46px",
    padding: "0 16px",
    background: color.surface,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    fontSize: font.base,
    fontWeight: weight.medium,
    cursor: "pointer",
  } as React.CSSProperties,

  ghostBtn: {
    height: "36px",
    padding: "0 12px",
    background: "transparent",
    color: color.textMuted,
    border: "none",
    borderRadius: radius.sm,
    fontSize: font.md,
    fontWeight: weight.medium,
    cursor: "pointer",
  } as React.CSSProperties,

  input: {
    width: "100%",
    height: "40px",
    padding: "0 12px",
    background: color.surface,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    fontSize: font.base,
    color: color.text,
    outline: "none",
  } as React.CSSProperties,

  // Row
  rowBetween: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  } as React.CSSProperties,

  divider: { height: 1, background: color.border, margin: "12px 0" } as React.CSSProperties,
};

export const statusMeta = (status: number) => {
  switch (status) {
    case 0: return { label: "Waiting", color: color.info, bg: color.infoSoft };
    case 1: return { label: "Accepted", color: color.info, bg: color.infoSoft };
    case 2: return { label: "Verifying", color: color.warning, bg: color.warningSoft };
    case 3: return { label: "Completed", color: color.success, bg: color.successSoft };
    case 4: return { label: "Cancelled", color: color.danger, bg: color.dangerSoft };
    default: return { label: "—", color: color.textFaint, bg: color.surfaceAlt };
  }
};
