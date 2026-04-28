// Modal de revisão pós-upload de PDF/imagem
// Mostra cada categoria detectada com transações listadas
// Permite reclassificar transações (mover de uma categoria para outra)
import React, { useMemo, useState } from "react";
import { CatIcon } from "./iconesCategorias";
import { brl as brlUtil, parseCentavos } from "../../utils/currency";
import { classificarItem } from "../../utils/documentParser";

function hexRgb(hex) {
  if (!hex || hex.length < 7) return "255,255,255";
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ].join(",");
}

export default function UploadReviewModal({
  open,
  cats,           // CATS array completo
  parsedData,     // resultado de parseFluxoFromText
  onConfirm,      // (dataFinal) => void
  onCancel,
}) {
  // Lista plana de transações: {id, data, nome, valor, categoria}
  const initial = useMemo(() => {
    if (!parsedData) return [];
    const out = [];
    let id = 0;
    cats.forEach((c) => {
      const items = parsedData[c.key + "_items"] || [];
      items.forEach((it) => {
        out.push({
          id: ++id,
          data: it.data || "",
          nome: it.nome || "",
          valor: it.valor || 0,
          categoria: c.key,
        });
      });
    });
    return out;
  }, [parsedData, cats]);

  const [transacoes, setTransacoes] = useState(initial);

  // Atualiza quando parsedData muda
  React.useEffect(() => {
    setTransacoes(initial);
  }, [initial]);

  // Agrupa por categoria
  const porCategoria = useMemo(() => {
    const map = {};
    cats.forEach((c) => { map[c.key] = []; });
    transacoes.forEach((t) => {
      if (!map[t.categoria]) map[t.categoria] = [];
      map[t.categoria].push(t);
    });
    return map;
  }, [transacoes, cats]);

  const totalSoma = transacoes.reduce((s, t) => s + (t.valor || 0), 0);
  const faturaTotal = parseCentavos(parsedData?._faturaTotal || "0");

  function moverPara(transacaoId, novaCategoria) {
    setTransacoes((list) =>
      list.map((t) => (t.id === transacaoId ? { ...t, categoria: novaCategoria } : t))
    );
  }

  function removerTransacao(transacaoId) {
    setTransacoes((list) => list.filter((t) => t.id !== transacaoId));
  }

  // Reclassifica todos itens em "outros" usando o dicionario.
  function autoReclassificar() {
    setTransacoes((list) =>
      list.map((t) => {
        if (t.categoria !== "outros") return t;
        const sugerido = classificarItem(t.nome);
        return sugerido !== "outros" ? { ...t, categoria: sugerido } : t;
      })
    );
  }

  const qtdOutros = transacoes.filter((t) => t.categoria === "outros").length;

  function confirmar() {
    // Reconstrói parsedData com as alterações
    const out = { ...parsedData };
    // Limpa _items antigos
    cats.forEach((c) => {
      delete out[c.key + "_items"];
    });
    // Reconstrói por categoria
    cats.forEach((c) => {
      const itens = porCategoria[c.key] || [];
      if (itens.length > 0) {
        out[c.key + "_items"] = itens.map((t) => ({
          data: t.data,
          nome: t.nome,
          valor: t.valor,
        }));
        // Recalcula total da categoria com base nas transações
        const soma = itens.reduce((s, t) => s + (t.valor || 0), 0);
        out[c.key] = String(soma);
      } else {
        delete out[c.key];
      }
    });
    onConfirm(out);
  }

  if (!open) return null;

  return (
    <div className="pi-review-backdrop" onClick={onCancel}>
      <div className="pi-review-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* Header */}
        <div className="pi-review-modal__header">
          <div>
            <div className="pi-review-modal__title">Revisar importação</div>
            <div className="pi-review-modal__sub">
              {transacoes.length} transações detectadas
              {faturaTotal > 0 && (
                <> · Total fatura: <b>{brlUtil(faturaTotal / 100)}</b></>
              )}
              {transacoes.length > 0 && (
                <> · Soma: <b>{brlUtil(totalSoma / 100)}</b></>
              )}
            </div>
          </div>
          <button type="button" className="pi-review-modal__close" onClick={onCancel} aria-label="Cancelar">
            ✕
          </button>
        </div>

        {/* Aviso */}
        <div className="pi-review-modal__hint">
          Confira a categoria de cada transação.
          Use o seletor para mover ou clique no ✕ para remover.
          {qtdOutros > 0 && (
            <>
              {" "}
              <button
                type="button"
                className="pi-review-modal__cta"
                onClick={autoReclassificar}
              >
                Tentar reclassificar {qtdOutros} {qtdOutros === 1 ? "item" : "itens"} em Outros
              </button>
            </>
          )}
        </div>

        {/* Lista por categoria */}
        <div className="pi-review-modal__body">
          {cats.map((c) => {
            const itens = porCategoria[c.key] || [];
            if (itens.length === 0) return null;
            const rgb = hexRgb(c.cor);
            const subtotal = itens.reduce((s, t) => s + (t.valor || 0), 0);
            return (
              <div key={c.key} className="pi-review-cat" style={{ "--cat-color": c.cor, "--cat-rgb": rgb }}>
                <div className="pi-review-cat__head">
                  <div className="pi-review-cat__icon" style={{ color: c.cor }}>
                    <CatIcon k={c.key} size={18} />
                  </div>
                  <div className="pi-review-cat__name">{c.label}</div>
                  <div className="pi-review-cat__count">{itens.length} {itens.length === 1 ? "item" : "itens"}</div>
                  <div className="pi-review-cat__sub" style={{ color: c.cor }}>{brlUtil(subtotal / 100)}</div>
                </div>
                <div className="pi-review-cat__list">
                  {itens.map((t) => (
                    <div key={t.id} className="pi-review-row">
                      <span className="pi-review-row__date">{t.data}</span>
                      <span className="pi-review-row__name">{t.nome}</span>
                      <span className="pi-review-row__val" style={{ color: c.cor }}>
                        {brlUtil((t.valor || 0) / 100)}
                      </span>
                      <select
                        className="pi-review-row__select"
                        value={t.categoria}
                        onChange={(e) => moverPara(t.id, e.target.value)}
                      >
                        {cats.map((cc) => (
                          <option key={cc.key} value={cc.key}>{cc.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="pi-review-row__del"
                        onClick={() => removerTransacao(t.id)}
                        aria-label="Remover"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {transacoes.length === 0 && (
            <div className="pi-review-empty">
              Nenhuma transação para confirmar.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pi-review-modal__footer">
          <button type="button" className="pi-sheet__btn pi-sheet__btn--ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="pi-sheet__btn pi-sheet__btn--primary pi-sheet__btn--gold" onClick={confirmar}>
            Confirmar e aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
