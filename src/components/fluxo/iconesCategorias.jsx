// Ícones SVG inline para categorias e fontes de renda
// Stroke based, herda currentColor — combina com a cor da categoria
/* eslint-disable react-refresh/only-export-components */
import React from "react";

const Svg = ({ children, size = 22 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0 }}
  >
    {children}
  </svg>
);

// ── Categorias de gastos ──────────────────────────────────────
export const ICONS_CAT = {
  moradia: (s) => (
    <Svg size={s}>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </Svg>
  ),
  alimentacao: (s) => (
    <Svg size={s}>
      <path d="M4 3v8a3 3 0 0 0 3 3h0v8" />
      <path d="M7 3v6" />
      <path d="M17 3c-1.5 1-2 3-2 5s.5 4 2 5v9" />
    </Svg>
  ),
  carro: (s) => (
    <Svg size={s}>
      <path d="M5 16V11l2-5h10l2 5v5" />
      <circle cx="7.5" cy="16.5" r="1.7" />
      <circle cx="16.5" cy="16.5" r="1.7" />
      <path d="M5 16h14" />
    </Svg>
  ),
  saude: (s) => (
    <Svg size={s}>
      <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" />
    </Svg>
  ),
  educacao: (s) => (
    <Svg size={s}>
      <path d="M2 9l10-5 10 5-10 5z" />
      <path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5" />
      <path d="M22 9v5" />
    </Svg>
  ),
  lazer: (s) => (
    <Svg size={s}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9.5h.01M15 9.5h.01" />
      <path d="M8.5 14.5c.8 1.2 2 2 3.5 2s2.7-.8 3.5-2" />
    </Svg>
  ),
  assinaturas: (s) => (
    <Svg size={s}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 9.5l5 2.5-5 2.5z" fill="currentColor" stroke="none" />
    </Svg>
  ),
  cartoes: (s) => (
    <Svg size={s}>
      <rect x="2.5" y="6" width="19" height="13" rx="2" />
      <path d="M2.5 10h19" />
      <path d="M6 15h3" />
    </Svg>
  ),
  seguros: (s) => (
    <Svg size={s}>
      <path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  ),
  outros: (s) => (
    <Svg size={s}>
      <circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  ),
};

// ── Fontes de renda ────────────────────────────────────────────
export const ICONS_RENDA = {
  salario: (s) => (
    <Svg size={s}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v.01M18 14.5v.01" />
    </Svg>
  ),
  prolabore: (s) => (
    <Svg size={s}>
      <path d="M4 21V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13" />
      <path d="M2 21h20" />
      <path d="M9 12h6M9 16h6" />
      <path d="M9 6V4h6v2" />
    </Svg>
  ),
  aluguel: (s) => (
    <Svg size={s}>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <path d="M10 21v-5h4v5" />
      <circle cx="12" cy="13" r="0.8" fill="currentColor" stroke="none" />
    </Svg>
  ),
  dividendos: (s) => (
    <Svg size={s}>
      <path d="M3 17l5-5 4 4 8-8" />
      <path d="M14 8h6v6" />
    </Svg>
  ),
  outros: (s) => (
    <Svg size={s}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
};

// Configuração das fontes de renda
export const RENDAS_CONFIG = [
  { key: "salario",    label: "Salário / CLT",       cor: "#22c55e" },
  { key: "prolabore",  label: "Pró-labore",          cor: "#10b981" },
  { key: "aluguel",    label: "Aluguéis recebidos",  cor: "#06b6d4" },
  { key: "dividendos", label: "Dividendos / JCP",    cor: "#3b82f6" },
  { key: "outros",     label: "Outras rendas",       cor: "#8b5cf6" },
];

// Helper: pega ícone da categoria
export function CatIcon({ k, size = 22 }) {
  const fn = ICONS_CAT[k];
  return fn ? fn(size) : ICONS_CAT.outros(size);
}

// Helper: pega ícone da fonte de renda
export function RendaIcon({ k, size = 22 }) {
  const fn = ICONS_RENDA[k];
  return fn ? fn(size) : ICONS_RENDA.outros(size);
}
