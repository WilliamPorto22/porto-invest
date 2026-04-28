import { memo, useEffect, useRef, useState } from "react";
import { T, C } from "../../theme";

// Desabilita seleção/edição visual (usado em wrappers clicáveis).
const noEdit = { userSelect: "none", WebkitUserSelect: "none", cursor: "default" };

// Input monetário com formatação automática em BRL.
// `initValue` é uma string de centavos (ex: "12345" → R$ 123,45).
export const InputMoeda = memo(function InputMoeda({ initValue, onCommit, placeholder = "R$ 0,00" }) {
  const [raw, setRaw] = useState(initValue || "");
  function fmt(r) {
    if (!r) return placeholder;
    const n = parseInt(String(r).replace(/\D/g, "")) || 0;
    return (n / 100).toLocaleString("pt-BR", {
      style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }
  function handleChange(e) {
    const v = e.target.value.replace(/\D/g, "");
    setRaw(v);
    onCommit(v);
  }
  return <input style={C.input} placeholder={placeholder} value={fmt(raw)} onChange={handleChange} />;
});

// Input de texto genérico com suporte a ref externa, handler de foco e indicação de erro.
export const InputTexto = memo(function InputTexto({
  initValue, onCommit, placeholder = "", type = "text", hasError = false, inputRef = null, onFocus = null,
}) {
  const [val, setVal] = useState(initValue || "");
  function handleChange(e) { setVal(e.target.value); onCommit(e.target.value); }
  const errStyle = hasError
    ? { border: "1px solid #ef4444", background: "rgba(239,68,68,0.06)", boxShadow: "0 0 0 3px rgba(239,68,68,0.12)" }
    : null;
  return (
    <input
      ref={inputRef}
      onFocus={onFocus}
      style={{ ...C.input, ...(errStyle || {}) }}
      type={type}
      placeholder={placeholder}
      value={val}
      onChange={handleChange}
    />
  );
});

// Textarea com altura fixa e sem resize (usado em campos de observação).
export const TextareaLocal = memo(function TextareaLocal({ initValue, onCommit, placeholder = "" }) {
  const [val, setVal] = useState(initValue || "");
  function handleChange(e) { setVal(e.target.value); onCommit(e.target.value); }
  return (
    <textarea
      style={{ ...C.input, height: 80, resize: "none", lineHeight: 1.6, paddingTop: 12 }}
      placeholder={placeholder}
      value={val}
      onChange={handleChange}
    />
  );
});

// Select customizado com dropdown (substitui o <select> nativo para estilização total).
export function CustomSelect({ value, onChange, options, placeholder = "Selecione" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function click(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", click);
    return () => document.removeEventListener("mousedown", click);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        style={{ ...C.input, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", ...noEdit }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ color: value ? T.textPrimary : T.textMuted, fontSize: 14 }}>{value || placeholder}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#111827", border: `0.5px solid ${T.border}`, borderRadius: 10, zIndex: 300,
          overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.5)", maxHeight: 220, overflowY: "auto",
        }}>
          {options.map(opt => (
            <div
              key={opt}
              style={{
                padding: "11px 16px", fontSize: 13,
                color: value === opt ? "#F0A202" : T.textSecondary,
                background: value === opt ? "rgba(240,162,2,0.08)" : "transparent",
                cursor: "pointer", ...noEdit,
              }}
              onMouseDown={e => { e.preventDefault(); onChange(opt); setOpen(false); }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Input de telefone com formatação automática (51) 99999-9999.
export const InputTelefone = memo(function InputTelefone({ initValue, onCommit }) {
  const [val, setVal] = useState(initValue || "");
  function fmt(raw) {
    const d = String(raw || "").replace(/\D/g, "").slice(0, 11);
    if (!d) return "";
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  function handleChange(e) {
    const formatted = fmt(e.target.value);
    setVal(formatted);
    onCommit(formatted);
  }
  return <input style={C.input} placeholder="(51) 99999-9999" value={val} onChange={handleChange} inputMode="tel" />;
});

// Input que aceita idade (1-3 dígitos até 120) OU data DD/MM/AAAA (4+ dígitos).
export const InputIdadeOuNasc = memo(function InputIdadeOuNasc({ initValue, onCommit }) {
  const [val, setVal] = useState(initValue || "");
  function fmt(raw) {
    const d = String(raw || "").replace(/\D/g, "").slice(0, 8);
    if (!d) return "";
    if (d.length <= 3) {
      const n = parseInt(d);
      if (n <= 120) return d;
      return d.slice(0, 2);
    }
    if (d.length <= 2) return d;
    if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
    return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  }
  function handleChange(e) {
    const formatted = fmt(e.target.value);
    setVal(formatted);
    onCommit(formatted);
  }
  return <input style={C.input} placeholder="Idade ou DD/MM/AAAA" value={val} onChange={handleChange} inputMode="numeric" />;
});

// Multi-select com checkboxes em dropdown.
export function MultiSelect({ values, onChange, options, placeholder = "Selecione" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const arr = Array.isArray(values) ? values : [];
  useEffect(() => {
    function click(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", click);
    return () => document.removeEventListener("mousedown", click);
  }, []);
  function toggle(opt) {
    if (arr.includes(opt)) onChange(arr.filter(x => x !== opt));
    else onChange([...arr, opt]);
  }
  const display = arr.length === 0 ? placeholder : arr.length <= 2 ? arr.join(", ") : `${arr.length} selecionados`;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        style={{ ...C.input, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", ...noEdit }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ color: arr.length > 0 ? T.textPrimary : T.textMuted, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{display}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#111827", border: `0.5px solid ${T.border}`, borderRadius: 10, zIndex: 300,
          overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.5)", maxHeight: 260, overflowY: "auto",
        }}>
          {options.map(opt => {
            const sel = arr.includes(opt);
            return (
              <div
                key={opt}
                style={{
                  padding: "11px 16px", fontSize: 13,
                  color: sel ? "#F0A202" : T.textSecondary,
                  background: sel ? "rgba(240,162,2,0.08)" : "transparent",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10, ...noEdit,
                }}
                onMouseDown={e => { e.preventDefault(); toggle(opt); }}
              >
                <div style={{
                  width: 14, height: 14, borderRadius: 4,
                  border: `1px solid ${sel ? "#F0A202" : T.textMuted}`,
                  background: sel ? "rgba(240,162,2,0.18)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  {sel && (
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#F0A202" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </div>
                <span>{opt}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Pills de escolha única inline. Permite desmarcar clicando no selecionado se `allowDeselect=true`.
export function PillChoice({ value, onChange, options, allowDeselect = true }) {
  const [hoverIdx, setHoverIdx] = useState(-1);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-start" }}>
      {options.map((opt, idx) => {
        const sel = value === opt;
        const hover = hoverIdx === idx && !sel;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(sel && allowDeselect ? "" : opt)}
            onMouseEnter={() => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(-1)}
            style={{
              padding: "10px 16px", borderRadius: 20, fontSize: 12.5,
              background: sel ? "rgba(240,162,2,0.16)" : hover ? "rgba(240,162,2,0.06)" : "rgba(255,255,255,0.03)",
              border: sel ? "0.5px solid rgba(240,162,2,0.55)" : hover ? "0.5px solid rgba(240,162,2,0.3)" : `0.5px solid ${T.border}`,
              color: sel ? "#F0A202" : hover ? "#F0EBD8" : T.textSecondary,
              fontFamily: "inherit", letterSpacing: "0.01em",
              transition: "all 0.16s", userSelect: "none", WebkitUserSelect: "none",
              cursor: "pointer",
              transform: hover ? "translateY(-1px)" : "none",
              boxShadow: sel ? "0 2px 8px rgba(240,162,2,0.12)" : "none",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
