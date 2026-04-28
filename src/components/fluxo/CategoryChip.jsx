// Chip/card moderno de categoria com ícone, total e barra de progresso
// Comportamento: clique abre o bottom sheet de detalhamento
/* eslint-disable react-refresh/only-export-components */
import React from "react";
import { CatIcon } from "./iconesCategorias";
import { brl as brlUtil, parseCentavos } from "../../utils/currency";

function hexRgb(hex) {
  if (!hex || hex.length < 7) return "255,255,255";
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ].join(",");
}

export default function CategoryChip({
  catKey,
  label,
  cor,
  desc,
  valor,        // em reais
  detail,       // array de {nome, valor}
  items,        // transações importadas
  pctTotal,     // % do total de gastos
  onClick,
}) {
  const rgb = hexRgb(cor);
  const hasVal = valor > 0;
  const nDetail = (detail || []).length;
  const nItems = (items || []).length;

  const subtitle = hasVal
    ? nDetail > 0
      ? `${nDetail} ${nDetail === 1 ? "item detalhado" : "itens detalhados"}`
      : nItems > 0
        ? `${nItems} ${nItems === 1 ? "transação" : "transações"} importadas`
        : "valor total informado"
    : desc;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`pi-cat-chip ${hasVal ? "pi-cat-chip--filled" : "pi-cat-chip--empty"}`}
      style={{
        "--cat-color": cor,
        "--cat-rgb": rgb,
      }}
    >
      <div className="pi-cat-chip__icon" style={{ color: cor }}>
        <CatIcon k={catKey} size={22} />
      </div>

      <div className="pi-cat-chip__body">
        <div className="pi-cat-chip__label">{label}</div>
        <div className="pi-cat-chip__sub">{subtitle}</div>
        {hasVal && pctTotal != null && (
          <div className="pi-cat-chip__bar">
            <div
              className="pi-cat-chip__bar-fill"
              style={{ width: `${pctTotal}%`, background: cor }}
            />
          </div>
        )}
      </div>

      <div className="pi-cat-chip__right">
        {hasVal ? (
          <>
            <div className="pi-cat-chip__value" style={{ color: cor }}>
              {brlUtil(valor)}
            </div>
            <div className="pi-cat-chip__pct">{pctTotal}%</div>
          </>
        ) : (
          <div className="pi-cat-chip__add" style={{ color: cor, borderColor: `rgba(${rgb},0.4)` }}>
            +
          </div>
        )}
      </div>
    </button>
  );
}

// Versão menor, somente leitura, para listas no modo "ver"
export function CategoryRow({ catKey, label, cor, valor, pctTotal, detail, items, onClick }) {
  const rgb = hexRgb(cor);
  const nDetail = (detail || []).length;
  const nItems = (items || []).length;
  const canExpand = nDetail > 0 || nItems > 0;

  return (
    <button
      type="button"
      onClick={canExpand ? onClick : undefined}
      className="pi-cat-row"
      style={{ "--cat-color": cor, "--cat-rgb": rgb, cursor: canExpand ? "pointer" : "default" }}
    >
      <div className="pi-cat-row__icon" style={{ color: cor }}>
        <CatIcon k={catKey} size={18} />
      </div>
      <div className="pi-cat-row__body">
        <div className="pi-cat-row__label">{label}</div>
        <div className="pi-cat-row__bar">
          <div
            className="pi-cat-row__bar-fill"
            style={{ width: `${pctTotal}%`, background: cor }}
          />
        </div>
      </div>
      <div className="pi-cat-row__right">
        <div className="pi-cat-row__value" style={{ color: cor }}>
          {brlUtil(valor)}
        </div>
        <div className="pi-cat-row__pct">{pctTotal}%</div>
      </div>
      {canExpand && <div className="pi-cat-row__chev" aria-hidden>›</div>}
    </button>
  );
}

// Re-export utilitário de soma para a página principal
export function somaDetalhe(list) {
  return (list || []).reduce((a, b) => a + parseCentavos(b.valor), 0);
}
