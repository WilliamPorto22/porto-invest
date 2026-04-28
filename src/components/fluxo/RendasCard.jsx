// Card de fontes de renda — múltiplas fontes (Salário, Pró-labore, Aluguéis, Dividendos, Outros)
// Estrutura: form._rendas = [{key, valor}]; valor em centavos string
// Mantém retrocompatibilidade com form.renda (renda principal/legacy)
import React, { useEffect, useRef, useState } from "react";
import { RendaIcon, RENDAS_CONFIG } from "./iconesCategorias";
import { brl as brlUtil, parseCentavos } from "../../utils/currency";

function fmtBR(c) {
  const n = parseCentavos(c);
  if (!n) return "";
  return "R$ " + (n / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function MoneyInput({ value, onChange, placeholder, cor, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => {
    if (autoFocus && ref.current) {
      const t = setTimeout(() => ref.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);
  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      className="pi-money-input pi-money-input--small"
      style={{ "--accent": cor }}
      placeholder={placeholder || "R$ 0,00"}
      value={fmtBR(value)}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
    />
  );
}

export default function RendasCard({ rendas, onChange, modo, totalRenda }) {
  const [expanded, setExpanded] = useState(false);

  // rendas: array [{key, valor}]; converte para mapa fácil
  const valorPor = Object.fromEntries((rendas || []).map((r) => [r.key, r.valor]));
  const ativasKeys = new Set((rendas || []).map((r) => r.key));

  // No modo "ver", mostra só as fontes ativas
  const fontesParaMostrar = modo === "ver"
    ? RENDAS_CONFIG.filter((f) => parseCentavos(valorPor[f.key]) > 0)
    : RENDAS_CONFIG;

  function setRenda(key, valor) {
    const list = [...(rendas || [])];
    const idx = list.findIndex((r) => r.key === key);
    if (valor == null || (typeof valor === "string" && parseCentavos(valor) === 0 && !ativasKeys.has(key))) {
      // se valor zero e não estava ativa, ignora
      return;
    }
    if (parseCentavos(valor) === 0) {
      // remove se zerou
      if (idx >= 0) list.splice(idx, 1);
    } else if (idx >= 0) {
      list[idx] = { key, valor };
    } else {
      list.push({ key, valor });
    }
    onChange(list);
  }

  function toggleFonte(key) {
    const list = [...(rendas || [])];
    const idx = list.findIndex((r) => r.key === key);
    if (idx >= 0) list.splice(idx, 1);
    else list.push({ key, valor: "" });
    onChange(list);
  }

  if (modo === "ver" && fontesParaMostrar.length === 0) {
    return null;
  }

  return (
    <div className="pi-rendas-card">
      <div className="pi-rendas-card__header">
        <div className="pi-rendas-card__title">
          <span className="pi-rendas-card__title-dot" />
          Fontes de Renda
        </div>
        {modo === "ver" && totalRenda > 0 && (
          <div className="pi-rendas-card__total">
            <span className="pi-rendas-card__total-label">Total mensal</span>
            <span className="pi-rendas-card__total-val">{brlUtil(totalRenda)}</span>
          </div>
        )}
        {modo === "editar" && (
          <button
            type="button"
            className="pi-rendas-card__expand"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? "Ver menos" : "Ver todas"}
          </button>
        )}
      </div>

      <div className="pi-rendas-card__list">
        {fontesParaMostrar.map((fonte) => {
          const valor = valorPor[fonte.key];
          const ativa = ativasKeys.has(fonte.key);
          const visivel = modo === "ver" || expanded || ativa || fonte.key === "salario";

          if (!visivel) return null;

          return (
            <div
              key={fonte.key}
              className={`pi-renda-row ${ativa ? "is-active" : ""}`}
              style={{ "--cat-color": fonte.cor }}
            >
              <div className="pi-renda-row__icon" style={{ color: fonte.cor }}>
                <RendaIcon k={fonte.key} size={18} />
              </div>
              <div className="pi-renda-row__label">{fonte.label}</div>

              {modo === "ver" ? (
                <div className="pi-renda-row__val" style={{ color: fonte.cor }}>
                  {brlUtil(parseCentavos(valor) / 100)}
                </div>
              ) : (
                <>
                  <div className="pi-renda-row__input">
                    <MoneyInput
                      value={valor || ""}
                      onChange={(v) => setRenda(fonte.key, v)}
                      cor={fonte.cor}
                      placeholder="R$ 0,00"
                    />
                  </div>
                  {ativa && (
                    <button
                      type="button"
                      className="pi-renda-row__remove"
                      onClick={() => toggleFonte(fonte.key)}
                      aria-label="Remover"
                    >
                      ✕
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {modo === "editar" && !expanded && (
        <button
          type="button"
          className="pi-rendas-card__add"
          onClick={() => setExpanded(true)}
        >
          + Adicionar outra fonte
        </button>
      )}
    </div>
  );
}
