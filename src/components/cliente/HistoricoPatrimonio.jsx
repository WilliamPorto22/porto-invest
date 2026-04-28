import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { listarSnapshots, formatarMesRef } from "../../services/snapshotsCarteira";
import { brl, formatMi } from "../../utils/currency";

/**
 * HistoricoPatrimonio — Gráfico real da evolução do patrimônio do cliente
 * usando os snapshots mensais (clientes/{id}/snapshotsCarteira).
 *
 * Comportamento:
 *   - Local-first: hidrata do cache localStorage primeiro, atualiza Firestore em background
 *   - Esconde se < 2 snapshots (mostra empty state amigável)
 *   - Calcula: valor atual, ganho 12m, % crescimento
 *   - Gráfico em área dourada com gradiente
 */

function calcularGanhos(snapshots) {
  if (!snapshots || snapshots.length === 0) return null;
  const ordered = [...snapshots].sort((a, b) => a.mesRef.localeCompare(b.mesRef));
  const ultimo = ordered[ordered.length - 1];
  const valorAtual = Number(ultimo.patrimonioTotal) || 0;

  // 12 meses atrás (ou o mais antigo disponível)
  const idx12 = Math.max(0, ordered.length - 13);
  const inicio = ordered[idx12];
  const valorInicio = Number(inicio.patrimonioTotal) || 0;

  const delta = valorAtual - valorInicio;
  const pct = valorInicio > 0 ? (delta / valorInicio) * 100 : 0;
  const meses = ordered.length - idx12 - 1;

  return { valorAtual, valorInicio, delta, pct, meses, mesRefAtual: ultimo.mesRef };
}

export default function HistoricoPatrimonio({ clienteId }) {
  const cacheKey = `pi_snapshots_${clienteId}`;

  // Hidrata snapshots do cache localStorage no mount (lazy init,
  // evita setState dentro de useEffect e re-render desnecessário).
  const [snapshots, setSnapshots] = useState(() => {
    if (typeof window === "undefined" || !clienteId) return [];
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached?.list && Array.isArray(cached.list)) return cached.list;
      }
    } catch { /* ignora */ }
    return [];
  });
  const [carregou, setCarregou] = useState(snapshots.length > 0);

  // Background fetch — só síncroniza estado externo (Firestore), não
  // dispara setState síncrono na entrada do effect (lint OK).
  useEffect(() => {
    if (!clienteId) return;
    let cancel = false;
    listarSnapshots(clienteId)
      .then((list) => {
        if (cancel) return;
        setSnapshots(list || []);
        setCarregou(true);
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ list, ts: Date.now() }));
        } catch { /* segue */ }
      })
      .catch((err) => {
        if (cancel) return;
        console.warn("[HistoricoPatrimonio] erro ao listar snapshots:", err);
        setCarregou(true);
      });
    return () => { cancel = true; };
  }, [clienteId, cacheKey]);

  const stats = useMemo(() => calcularGanhos(snapshots), [snapshots]);

  // Dados do gráfico (mais antigo → mais recente)
  const dadosGrafico = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];
    return [...snapshots]
      .sort((a, b) => a.mesRef.localeCompare(b.mesRef))
      .map((s) => ({
        mes: s.mesRef,
        mesLabel: formatarMesRef(s.mesRef).split("/")[0].slice(0, 3),
        valor: Number(s.patrimonioTotal) || 0,
      }));
  }, [snapshots]);

  // Não mostra nada enquanto carrega (evita flash de empty state)
  if (!carregou) return null;

  // Sem ao menos 2 snapshots não há evolução pra mostrar.
  // Retornamos null em vez de placeholder "em breve" para não criar 346px de buraco visual.
  // Quando o segundo extrato chegar, o gráfico aparece sozinho.
  if (snapshots.length < 2) return null;

  const positivo = stats && stats.delta >= 0;
  const cor = positivo ? "#00CC66" : "#ef4444";

  return (
    <div className="liberdade-section">
      <div className="liberdade-section-header">
        <span>Sua evolução patrimonial</span>
        <div className="liberdade-section-divider" />
        <span className="liberdade-section-count">{snapshots.length} meses</span>
      </div>

      <div className="historico-card">
        {/* Header: valor atual + delta */}
        <div className="historico-header">
          <div>
            <div className="historico-eyebrow">Patrimônio hoje</div>
            <div className="historico-valor">{brl(stats.valorAtual)}</div>
          </div>
          <div className="historico-delta-bloco" style={{ color: cor }}>
            <div className="historico-delta-label">
              {stats.meses > 0
                ? `Últimos ${stats.meses} ${stats.meses === 1 ? "mês" : "meses"}`
                : "Sem comparação"}
            </div>
            <div className="historico-delta-valor">
              {positivo ? "+" : "−"}{brl(Math.abs(stats.delta))}
            </div>
            <div className="historico-delta-pct">
              {positivo ? "+" : ""}{stats.pct.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Gráfico em área */}
        <div className="historico-grafico">
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={dadosGrafico} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="historicoGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={cor} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={cor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="mesLabel"
                tick={{ fill: "#748CAB", fontSize: 11 }}
                axisLine={{ stroke: "rgba(62,92,118,0.3)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#748CAB", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatMi(v)}
                width={50}
              />
              <Tooltip
                contentStyle={{
                  background: "#1a2747",
                  border: "0.5px solid rgba(240,162,2,0.3)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "#F0EBD8",
                }}
                labelStyle={{ color: "#FFB20F", fontWeight: 600 }}
                formatter={(val) => [brl(val), "Patrimônio"]}
                labelFormatter={(label, payload) => {
                  const item = payload?.[0]?.payload;
                  return item ? formatarMesRef(item.mes) : label;
                }}
              />
              <Area
                type="monotone"
                dataKey="valor"
                stroke={cor}
                strokeWidth={2.5}
                fill="url(#historicoGrad)"
                animationDuration={800}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
