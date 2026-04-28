import { useEffect, useState } from "react";
import { T, C } from "../../theme";
import { MARCAS_VEICULOS_BR } from "../../constants/veiculosBrasil";

const noEdit = { userSelect: "none", WebkitUserSelect: "none", cursor: "default" };

// Picker premium: abre modal com fluxo marca → modelo para escolher veículo.
// Suporta "modelo custom" quando não está na lista.
// `value` = string "Marca Modelo" (legado) ou "" vazio.
// `onChange(full, { marca, modelo })` — chamado ao confirmar.
export function VeiculoPicker({ value, onChange, placeholder = "Escolher marca e modelo" }) {
  const [open, setOpen] = useState(false);
  const [marcaSel, setMarcaSel] = useState(null);
  const [busca, setBusca] = useState("");
  const [modeloCustom, setModeloCustom] = useState("");

  useEffect(() => {
    if (!open) {
      setMarcaSel(null);
      setBusca("");
      setModeloCustom("");
    }
  }, [open]);

  const norm = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const termo = norm(busca);
  const marcasFiltradas = termo
    ? MARCAS_VEICULOS_BR.filter(m => norm(m.marca).includes(termo))
    : MARCAS_VEICULOS_BR;
  const modelosFiltrados = marcaSel
    ? (termo
        ? marcaSel.modelos.filter(md => norm(md).includes(termo))
        : marcaSel.modelos)
    : [];

  function escolher(marca, modelo) {
    const full = `${marca} ${modelo}`.trim();
    onChange(full, { marca, modelo });
    setOpen(false);
  }

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        style={{
          ...C.input,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          ...noEdit,
        }}
      >
        <span style={{ color: value ? T.textPrimary : T.textMuted, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value || placeholder}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 700,
            background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: T.bgCard,
              border: `0.5px solid ${T.border}`,
              borderRadius: 18,
              width: 560,
              maxWidth: "100%",
              maxHeight: "88vh",
              display: "flex", flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            }}
          >
            {/* Header */}
            <div style={{ padding: "18px 22px 14px", borderBottom: `0.5px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
              {marcaSel && (
                <button
                  onClick={() => { setMarcaSel(null); setBusca(""); }}
                  aria-label="Voltar para marcas"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: `0.5px solid ${T.border}`,
                    borderRadius: 8,
                    width: 32, height: 32,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer",
                    color: T.textSecondary,
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                >←</button>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: T.gold, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 3 }}>
                  {marcaSel ? "2 · Escolher modelo" : "1 · Escolher marca"}
                </div>
                <div style={{ fontSize: 15, fontWeight: 500, color: T.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {marcaSel ? marcaSel.marca : "Marcas vendidas no Brasil"}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: `0.5px solid ${T.border}`,
                  borderRadius: 8,
                  width: 32, height: 32,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer",
                  color: T.textSecondary,
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >×</button>
            </div>

            {/* Search */}
            <div style={{ padding: "12px 18px 10px" }}>
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={marcaSel ? `Buscar modelo ${marcaSel.marca}...` : "Buscar marca..."}
                style={{ ...C.input, fontSize: 13 }}
              />
            </div>

            {/* Lista */}
            <div style={{ flex: 1, overflowY: "auto", padding: "4px 12px 16px" }}>
              {!marcaSel ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                  {marcasFiltradas.length === 0 && (
                    <div style={{ gridColumn: "1/-1", padding: "22px 14px", fontSize: 12, color: T.textMuted, textAlign: "center" }}>
                      Nenhuma marca encontrada.
                    </div>
                  )}
                  {marcasFiltradas.map(m => (
                    <button
                      key={m.marca}
                      onClick={() => { setMarcaSel(m); setBusca(""); }}
                      style={{
                        textAlign: "left",
                        padding: "12px 14px",
                        background: "rgba(255,255,255,0.03)",
                        border: `0.5px solid ${T.border}`,
                        borderRadius: 10,
                        cursor: "pointer",
                        color: T.textPrimary,
                        fontSize: 13,
                        fontFamily: "inherit",
                        fontWeight: 500,
                        transition: "all 0.15s",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(240,162,2,0.08)";
                        e.currentTarget.style.borderColor = "rgba(240,162,2,0.3)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                        e.currentTarget.style.borderColor = T.border;
                      }}
                    >
                      <span>{m.marca}</span>
                      <span style={{ fontSize: 10, color: T.textMuted, fontWeight: 400 }}>
                        {m.modelos.length}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {modelosFiltrados.length === 0 && (
                    <div style={{ padding: "22px 14px", fontSize: 12, color: T.textMuted, textAlign: "center" }}>
                      Nenhum modelo encontrado.
                    </div>
                  )}
                  {modelosFiltrados.map(md => (
                    <button
                      key={md}
                      onClick={() => escolher(marcaSel.marca, md)}
                      style={{
                        textAlign: "left",
                        padding: "11px 14px",
                        background: "rgba(255,255,255,0.02)",
                        border: `0.5px solid ${T.border}`,
                        borderRadius: 9,
                        cursor: "pointer",
                        color: T.textPrimary,
                        fontSize: 13,
                        fontFamily: "inherit",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(240,162,2,0.07)";
                        e.currentTarget.style.borderColor = "rgba(240,162,2,0.3)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                        e.currentTarget.style.borderColor = T.border;
                      }}
                    >
                      {md}
                    </button>
                  ))}
                  {/* Permitir informar manualmente um modelo que não está na lista */}
                  <div style={{ marginTop: 10, padding: "12px 14px", background: "rgba(240,162,2,0.04)", border: "0.5px dashed rgba(240,162,2,0.3)", borderRadius: 9 }}>
                    <div style={{ fontSize: 10, color: "#F0A202", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
                      Modelo não listado?
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        value={modeloCustom}
                        onChange={(e) => setModeloCustom(e.target.value)}
                        placeholder="Digite o modelo"
                        style={{ ...C.input, fontSize: 13, flex: 1 }}
                      />
                      <button
                        onClick={() => {
                          const v = modeloCustom.trim();
                          if (v) escolher(marcaSel.marca, v);
                        }}
                        disabled={!modeloCustom.trim()}
                        style={{
                          padding: "10px 16px",
                          background: modeloCustom.trim() ? "rgba(240,162,2,0.18)" : "rgba(255,255,255,0.03)",
                          border: modeloCustom.trim() ? "0.5px solid rgba(240,162,2,0.5)" : `0.5px solid ${T.border}`,
                          borderRadius: 9,
                          color: modeloCustom.trim() ? "#F0A202" : T.textMuted,
                          fontSize: 11,
                          cursor: modeloCustom.trim() ? "pointer" : "not-allowed",
                          fontFamily: "inherit",
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >Usar</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
