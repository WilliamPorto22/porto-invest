// Bottom sheet de detalhamento de categoria
// Abre de baixo no mobile / centralizado no desktop
// Permite: digitar total único OU selecionar sub-itens (chips) e atribuir valor
import React, { useEffect, useMemo, useRef, useState } from "react";
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

function fmtBR(c) {
  const n = parseCentavos(c);
  if (!n) return "";
  return "R$ " + (n / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Input de moeda local — máscara só com dígitos
function MoneyInput({ value, onChange, placeholder, autoFocus, cor }) {
  const ref = useRef(null);
  useEffect(() => {
    if (autoFocus && ref.current) {
      // pequeno timeout para esperar a animação do sheet
      const t = setTimeout(() => ref.current?.focus(), 220);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);
  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      className="pi-money-input"
      style={{ "--accent": cor }}
      placeholder={placeholder || "R$ 0,00"}
      value={fmtBR(value)}
      onChange={(e) => {
        const novo = e.target.value.replace(/\D/g, "");
        onChange(novo);
      }}
    />
  );
}

export default function CategorySheet({
  open,
  onClose,
  category,        // { key, label, cor, desc }
  items,           // sub-itens pré-definidos
  detail,          // array atual [{nome, valor}]
  totalManual,     // string em centavos (caso prefira só total)
  onChangeDetail,  // (catKey, nome, valor|null) => void
  onChangeTotal,   // (catKey, valor) => void
  onClearDetail,   // (catKey) => void
  onUpload,        // () => void  (botão "anexar fatura desta categoria")
  importedItems,   // transações importadas para esta categoria (read-only)
}) {
  const [tab, setTab] = useState("detalhar"); // "detalhar" | "total"
  const [busca, setBusca] = useState("");

  const catKey = category?.key;
  const cor = category?.cor || "#F0A202";
  const rgb = hexRgb(cor);

  // valores indexados por nome para renderizar status
  const valorPor = useMemo(() => {
    return Object.fromEntries((detail || []).map((d) => [d.nome, d.valor]));
  }, [detail]);

  const marcados = useMemo(() => new Set((detail || []).map((d) => d.nome)), [detail]);

  const soma = useMemo(
    () => (detail || []).reduce((a, b) => a + parseCentavos(b.valor), 0) / 100,
    [detail]
  );

  // Reset de aba quando abre uma nova categoria
  useEffect(() => {
    if (open) {
      // se já tem total manual e nenhum item detalhado, abre na aba "total"
      const hasDetail = (detail || []).length > 0;
      const hasTotalManual = parseCentavos(totalManual) > 0 && !hasDetail;
      setTab(hasTotalManual ? "total" : "detalhar");
      setBusca("");
    }
  // detail/totalManual intencionalmente fora — só reseta ao abrir nova categoria
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, catKey]);

  // Trava scroll do body quando aberto
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ESC fecha
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !category) return null;

  const itemsFiltrados = (items || []).filter((nome) =>
    nome.toLowerCase().includes(busca.toLowerCase().trim())
  );

  return (
    <div className="pi-sheet-backdrop" onClick={onClose}>
      <div
        className="pi-sheet"
        style={{ "--cat-color": cor, "--cat-rgb": rgb }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Handle drag visual */}
        <div className="pi-sheet__handle" />

        {/* Header */}
        <div className="pi-sheet__header">
          <div className="pi-sheet__head-icon" style={{ color: cor, background: `rgba(${rgb},0.12)`, border: `1px solid rgba(${rgb},0.3)` }}>
            <CatIcon k={catKey} size={22} />
          </div>
          <div className="pi-sheet__head-text">
            <div className="pi-sheet__title">{category.label}</div>
            <div className="pi-sheet__subtitle">{category.desc}</div>
          </div>
          <button type="button" className="pi-sheet__close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="pi-sheet__tabs">
          <button
            type="button"
            className={`pi-sheet__tab ${tab === "detalhar" ? "is-active" : ""}`}
            onClick={() => setTab("detalhar")}
          >
            Detalhar por item
            {marcados.size > 0 && <span className="pi-sheet__tab-count">{marcados.size}</span>}
          </button>
          <button
            type="button"
            className={`pi-sheet__tab ${tab === "total" ? "is-active" : ""}`}
            onClick={() => setTab("total")}
          >
            Total único
          </button>
        </div>

        {/* Conteúdo: Detalhar */}
        {tab === "detalhar" && (
          <div className="pi-sheet__content">
            {/* Busca */}
            <div className="pi-sheet__search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
              </svg>
              <input
                type="text"
                placeholder="Buscar item..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
              {busca && (
                <button type="button" onClick={() => setBusca("")} aria-label="Limpar">✕</button>
              )}
            </div>

            {/* Total atual */}
            <div className="pi-sheet__summary">
              <span>{marcados.size} item{marcados.size === 1 ? "" : "s"} selecionado{marcados.size === 1 ? "" : "s"}</span>
              <strong style={{ color: cor }}>{brlUtil(soma)}</strong>
            </div>

            {/* Grid de chips */}
            <div className="pi-sheet__chips">
              {itemsFiltrados.length === 0 && (
                <div className="pi-sheet__empty">Nenhum item encontrado para "{busca}"</div>
              )}
              {itemsFiltrados.map((nome) => {
                const ativo = marcados.has(nome);
                const valor = valorPor[nome] || "";
                return (
                  <div key={nome} className={`pi-sub-chip ${ativo ? "is-active" : ""}`}>
                    <button
                      type="button"
                      className="pi-sub-chip__head"
                      onClick={() => {
                        if (ativo) onChangeDetail(catKey, nome, null);
                        else onChangeDetail(catKey, nome, "");
                      }}
                    >
                      <span className="pi-sub-chip__check" aria-hidden>
                        {ativo ? "✓" : "+"}
                      </span>
                      <span className="pi-sub-chip__name">{nome}</span>
                      {ativo && parseCentavos(valor) > 0 && (
                        <span className="pi-sub-chip__val" style={{ color: cor }}>
                          {brlUtil(parseCentavos(valor) / 100)}
                        </span>
                      )}
                    </button>
                    {ativo && (
                      <div className="pi-sub-chip__input">
                        <MoneyInput
                          value={valor}
                          onChange={(v) => onChangeDetail(catKey, nome, v)}
                          autoFocus={parseCentavos(valor) === 0}
                          cor={cor}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Transações importadas (só leitura) */}
            {importedItems && importedItems.length > 0 && (
              <div className="pi-sheet__imported">
                <div className="pi-sheet__imported-title">
                  Transações importadas ({importedItems.length})
                </div>
                <div className="pi-sheet__imported-list">
                  {importedItems.map((it, idx) => (
                    <div key={idx} className="pi-sheet__imported-row">
                      <span className="pi-sheet__imported-date">{it.data}</span>
                      <span className="pi-sheet__imported-name">{it.nome}</span>
                      <span className="pi-sheet__imported-val" style={{ color: cor }}>
                        {brlUtil((it.valor || 0) / 100)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Conteúdo: Total único */}
        {tab === "total" && (
          <div className="pi-sheet__content">
            <div className="pi-sheet__total-hint">
              Use este modo se você prefere informar apenas o total geral desta categoria,
              sem detalhar item por item.
            </div>
            <MoneyInput
              value={totalManual || ""}
              onChange={(v) => onChangeTotal(catKey, v)}
              placeholder="R$ 0,00"
              autoFocus
              cor={cor}
            />
            {marcados.size > 0 && (
              <div className="pi-sheet__warn">
                ⚠ Você tem {marcados.size} item{marcados.size === 1 ? "" : "s"} detalhado{marcados.size === 1 ? "" : "s"}.
                Se preencher um total aqui, ele <b>substitui</b> o detalhamento.
                <button
                  type="button"
                  className="pi-sheet__warn-btn"
                  onClick={() => onClearDetail(catKey)}
                >
                  Limpar detalhes
                </button>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="pi-sheet__footer">
          {onUpload && (
            <button
              type="button"
              className="pi-sheet__btn pi-sheet__btn--ghost"
              onClick={onUpload}
            >
              ↑ Anexar fatura desta categoria
            </button>
          )}
          <button
            type="button"
            className="pi-sheet__btn pi-sheet__btn--primary"
            onClick={onClose}
            style={{ background: `rgba(${rgb},0.16)`, color: cor, borderColor: `rgba(${rgb},0.4)` }}
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}
