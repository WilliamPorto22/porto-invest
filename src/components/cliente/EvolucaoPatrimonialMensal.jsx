import { useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { brl, brlCompact } from "../../utils/currency";

/**
 * EvolucaoPatrimonialMensal — Cards horizontais mês a mês no estilo Itaú.
 *
 * Renderiza uma fita com 5 meses (2 passados + atual + 2 projetados):
 *   • Passados: card sólido, ponto preenchido, linha cheia
 *   • Atual:    card destacado em dourado, ponto vazado azul
 *   • Futuros:  card translúcido, ponto vazado, linha tracejada (projeção)
 *
 * Fonte de dados: array `snapshots` (clientes/{id}/snapshotsCarteira),
 * mesmo formato consumido pelo HistoricoPatrimonio. Quando há < 1 snapshot
 * real, retorna null (não polui o painel com placeholder).
 *
 * Projeção dos meses futuros: tendência linear simples sobre os últimos
 * 3 snapshots reais + média de aportes do `aportesHistorico` se passado.
 */

const MESES_LABEL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function parseMes(mesRef) {
  if (!mesRef) return null;
  const [y, m] = mesRef.split("-").map((n) => parseInt(n));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  return { ano: y, mes: m };
}

function mesRefStr(ano, mes) {
  let y = ano, m = mes;
  while (m <= 0) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return { mesRef: `${y}-${String(m).padStart(2, "0")}`, ano: y, mes: m };
}

function mediaAportesRecentes(aportesHistorico) {
  if (!Array.isArray(aportesHistorico) || aportesHistorico.length === 0) return 0;
  const ultimos = aportesHistorico.slice(-6);
  const total = ultimos.reduce((acc, a) => {
    const v = Number(String(a?.valor || "0").replace(/\D/g, "")) / 100;
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
  return ultimos.length ? total / ultimos.length : 0;
}

function tendenciaMensal(snapshotsOrdenados) {
  // Slope médio dos últimos 3 deltas (R$ por mês). Defensivo para 1-2 pontos.
  if (!snapshotsOrdenados || snapshotsOrdenados.length < 2) return 0;
  const seq = snapshotsOrdenados.slice(-4).map((s) => Number(s.patrimonioTotal) || 0);
  let somaDelta = 0, n = 0;
  for (let i = 1; i < seq.length; i++) {
    somaDelta += seq[i] - seq[i - 1];
    n++;
  }
  return n ? somaDelta / n : 0;
}

export default function EvolucaoPatrimonialMensal({ snapshots, cliente, clienteId }) {
  const navigate = useNavigate();
  const location = useLocation();
  const ehAssessor = location.pathname.startsWith("/cliente/");
  const irParaCarteira = (mesRef) => {
    const destino = ehAssessor && clienteId
      ? `/cliente/${clienteId}/carteira`
      : "/me/carteira";
    navigate(`${destino}?mes=${mesRef}`);
  };

  const dados = useMemo(() => {
    const lista = Array.isArray(snapshots) ? [...snapshots] : [];
    if (lista.length === 0) return { vazio: true };

    const ordenados = lista
      .filter((s) => s?.mesRef && Number(s.patrimonioTotal) >= 0)
      .sort((a, b) => String(a.mesRef).localeCompare(String(b.mesRef)));
    if (ordenados.length === 0) return { vazio: true };

    const hoje = new Date();
    const refAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;

    // Projeção: slope mensal + aporte médio (toma o que for maior em magnitude
    // pra evitar projeção plana quando a rentabilidade é pequena).
    const slope = tendenciaMensal(ordenados);
    const aporteMedio = mediaAportesRecentes(cliente?.aportesHistorico);
    const incrementoMes = slope + aporteMedio * 0.7; // suaviza projeção

    // Mapa mesRef → snapshot pra lookup rápido
    const mapRef = new Map();
    ordenados.forEach((s) => mapRef.set(s.mesRef, s));

    const ultimo = ordenados[ordenados.length - 1];
    const baseProjecao = Number(ultimo.patrimonioTotal) || 0;
    const baseInfo = parseMes(ultimo.mesRef);
    const atualInfo = parseMes(refAtual);

    // Janela: 2 meses antes do atual + atual + 2 meses depois
    const janela = [];
    for (let offset = -2; offset <= 2; offset++) {
      const { mesRef, ano, mes } = mesRefStr(atualInfo.ano, atualInfo.mes + offset);
      const real = mapRef.get(mesRef);

      let valor = null;
      let tipo;
      let aguardando = false;
      if (offset < 0) {
        // Passado — usa real se existir, senão pula (deixa null pra visual ficar vazio)
        valor = real ? Number(real.patrimonioTotal) : null;
        tipo = "passado";
      } else if (offset === 0) {
        const realVal = real ? Number(real.patrimonioTotal) || 0 : 0;
        // "Aguardando importação": o mês corrente está vazio/zerado E existe
        // pelo menos um snapshot ANTERIOR com patrimônio > 0. Garante o flag
        // mesmo quando o snapshot do mês foi criado vazio pelo auto-snapshot.
        const temAnteriorReal = ordenados.some(
          (s) => String(s.mesRef) < mesRef && Number(s.patrimonioTotal) > 0
        );
        if (realVal <= 0 && temAnteriorReal) {
          valor = null;
          aguardando = true;
        } else {
          valor = real ? realVal : baseProjecao;
        }
        tipo = "atual";
      } else {
        // Futuro — projeção a partir do último ponto real (ou mês atual)
        if (baseInfo) {
          const passos = (ano - baseInfo.ano) * 12 + (mes - baseInfo.mes);
          valor = Math.max(0, baseProjecao + incrementoMes * Math.max(passos, 0));
        }
        tipo = "futuro";
      }

      // Aporte do mês via snapshot ou aportesHistorico (mesmo critério do
      // HistoricoMensalChart — soma valores em centavos do array do cliente).
      const aporteSnap = Number(real?.resumoMes?.aportes) || 0;
      let aporteMes = aporteSnap;
      if (aporteMes === 0 && Array.isArray(cliente?.aportesHistorico)) {
        aporteMes = cliente.aportesHistorico.reduce((acc, a) => {
          const matchMes =
            (Number(a?.mes) === mes && Number(a?.ano) === ano) ||
            (typeof a?.data === "string" && a.data.startsWith(mesRef));
          if (!matchMes) return acc;
          const v = Number(String(a?.valor || "0").replace(/\D/g, "")) / 100;
          return acc + (Number.isFinite(v) ? v : 0);
        }, 0);
      }
      const rendMes = (Number(real?.resumoMes?.dividendos) || 0) + (Number(real?.resumoMes?.juros) || 0);

      janela.push({
        mesRef,
        label: MESES_LABEL[mes - 1],
        ano,
        valor,
        tipo,
        ehReal: !!real,
        aguardando,
        aporteMes,
        rendMes,
      });
    }

    // Patrimônio atual + delta vs mês anterior (real, se houver).
    // Quando o atual está "aguardando", usamos o último real anterior como
    // patrimônio exibido pra evitar exibir R$ 0 e delta -100%.
    const atual = janela.find((j) => j.tipo === "atual");
    const anterior = janela.filter((j) => j.tipo === "passado" && j.valor != null).slice(-1)[0];
    const valorAnterior = anterior?.valor ?? null;
    const aguardandoAtual = !!atual?.aguardando;
    const valorAtual = aguardandoAtual ? (valorAnterior ?? 0) : (atual?.valor ?? 0);
    const delta = (valorAnterior != null && !aguardandoAtual) ? valorAtual - valorAnterior : 0;
    const pct = (valorAnterior && !aguardandoAtual) ? (delta / valorAnterior) * 100 : 0;

    return {
      janela,
      valorAtual,
      delta,
      pct,
      temAnterior: valorAnterior != null && !aguardandoAtual,
      aguardandoAtual,
    };
  }, [snapshots, cliente]);

  if (!dados) return null;

  // Estado vazio: nenhum snapshot ainda → cartão informativo (em vez de sumir).
  if (dados.vazio) {
    const ehAssessorView = location.pathname.startsWith("/cliente/");
    return (
      <div className="liberdade-section">
        <div className="liberdade-section-header">
          <span>Sua evolução patrimonial</span>
          <div className="liberdade-section-divider" />
          <span className="liberdade-section-count">aguardando dados</span>
        </div>
        <div className="evol-card" style={{ padding: "28px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 38, marginBottom: 12, opacity: 0.55 }}>📊</div>
          <div style={{ fontSize: 15, color: "#F0EBD8", fontWeight: 500, marginBottom: 8 }}>
            Nenhum extrato importado ainda
          </div>
          <div style={{ fontSize: 12, color: "#94A7BF", lineHeight: 1.6, maxWidth: 420, margin: "0 auto 16px" }}>
            Importe um PDF mensal na <strong style={{ color: "#FFB20F" }}>Carteira</strong> para começar a acompanhar a evolução do patrimônio mês a mês.
          </div>
          {clienteId && (
            <button
              type="button"
              onClick={() => navigate(ehAssessorView ? `/cliente/${clienteId}/carteira` : "/me/carteira")}
              style={{
                background: "rgba(255,178,15,0.12)",
                border: "0.5px solid rgba(255,178,15,0.35)",
                color: "#FFB20F",
                padding: "10px 18px",
                borderRadius: 10,
                fontSize: 11,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 500,
              }}
            >
              Ir para a carteira →
            </button>
          )}
        </div>
      </div>
    );
  }

  const { janela, valorAtual, delta, pct, temAnterior, aguardandoAtual } = dados;
  const positivo = delta >= 0;

  // Coordenadas SVG: 5 cards horizontais. Largura virtual = 1000.
  const W = 1000;
  const H = 70;
  const cx = (i) => 100 + i * 200; // 100, 300, 500, 700, 900

  // Y normalizado a partir dos valores (apenas para a curva)
  const valoresValidos = janela.map((j) => j.valor).filter((v) => v != null && v >= 0);
  const minV = Math.min(...valoresValidos);
  const maxV = Math.max(...valoresValidos);
  const range = Math.max(maxV - minV, 1);
  const yFor = (v) => {
    if (v == null) return H / 2;
    const norm = (v - minV) / range; // 0..1
    return 56 - norm * 36; // 20 (alto) → 56 (baixo)
  };

  // Caminhos: sólido entre passados+atual, tracejado depois
  const pontosSolidos = [];
  const pontosTracejados = [];
  janela.forEach((j, i) => {
    const p = { x: cx(i), y: yFor(j.valor), valor: j.valor };
    if (j.tipo === "futuro") {
      pontosTracejados.push(p);
    } else {
      pontosSolidos.push(p);
      // O atual também é o início do tracejado
      if (j.tipo === "atual") pontosTracejados.unshift(p);
    }
  });

  const pathFrom = (pts) => {
    const validos = pts.filter((p) => p.valor != null);
    if (validos.length < 2) return "";
    return validos.reduce((acc, p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const prev = validos[i - 1];
      const cx1 = (prev.x + p.x) / 2;
      return `${acc} C ${cx1} ${prev.y}, ${cx1} ${p.y}, ${p.x} ${p.y}`;
    }, "");
  };

  return (
    <div className="liberdade-section">
      <div className="liberdade-section-header">
        <span>Sua evolução patrimonial</span>
        <div className="liberdade-section-divider" />
        <span className="liberdade-section-count">5 meses</span>
      </div>

      <div className="evol-card">
        <div className="evol-header">
          <div>
            <div className="evol-eyebrow">Patrimônio atual</div>
            <div className="evol-valor">{brl(valorAtual)}</div>
          </div>
          {temAnterior && (
            <div className="evol-delta-bloco" style={{ color: positivo ? "#00CC66" : "#ef4444" }}>
              <div className="evol-delta-label">No mês</div>
              <div className="evol-delta-valor">
                {positivo ? "+" : "−"}{brl(Math.abs(delta))}
              </div>
              <div className="evol-delta-pct">
                {positivo ? "+" : ""}{pct.toFixed(1)}%
              </div>
            </div>
          )}
        </div>

        <div className="evol-fita-wrap">
          <svg
            className="evol-svg"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="evolGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00CC66" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#00CC66" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Área sob a parte sólida */}
            {pontosSolidos.filter((p) => p.valor != null).length >= 2 && (
              <path
                d={`${pathFrom(pontosSolidos)} L ${pontosSolidos[pontosSolidos.length - 1].x} ${H} L ${pontosSolidos[0].x} ${H} Z`}
                fill="url(#evolGrad)"
              />
            )}
            {/* Linha sólida (passado → atual) */}
            <path
              d={pathFrom(pontosSolidos)}
              fill="none"
              stroke="#00CC66"
              strokeWidth="2.5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {/* Linha tracejada (atual → futuro) */}
            <path
              d={pathFrom(pontosTracejados)}
              fill="none"
              stroke="#3E5C76"
              strokeWidth="2"
              strokeDasharray="5 5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Bolinhas como overlay HTML — posicionadas em % pra não esticarem
              em elipse quando o SVG faz preserveAspectRatio="none". */}
          <div className="evol-dots">
            {janela.map((j, i) => {
              if (j.valor == null) return null;
              const xPct = (cx(i) / W) * 100;
              const yPct = (yFor(j.valor) / H) * 100;
              const cls = `evol-dot evol-dot-${j.tipo}`;
              return (
                <span
                  key={j.mesRef}
                  className={cls}
                  style={{ left: `${xPct}%`, top: `${yPct}%` }}
                  aria-hidden="true"
                />
              );
            })}
          </div>

          <div className="evol-cards-row">
            {janela.map((j) => (
              <button
                type="button"
                key={j.mesRef}
                onClick={() => irParaCarteira(j.mesRef)}
                title={`Abrir carteira do cliente em ${j.label}`}
                className={`evol-card-mes evol-card-${j.tipo}${j.ehReal ? " evol-card-real" : ""}`}
              >
                <div className="evol-card-mes-label">
                  {j.label}
                  {j.tipo === "atual" && <span className="evol-card-mes-badge">atual</span>}
                </div>
                <div className="evol-card-mes-valor">
                  {j.valor != null ? brl(j.valor) : "—"}
                </div>
                {j.tipo === "atual" && j.aguardando && (
                  <div className="evol-card-mes-tag" style={{ color: "#FFB20F", opacity: 0.85 }}>
                    aguardando importação
                  </div>
                )}
                {j.tipo === "futuro" && (
                  <div className="evol-card-mes-tag">projeção</div>
                )}
                {j.tipo === "passado" && j.ehReal && (
                  <div className="evol-card-mes-tag evol-tag-real">real</div>
                )}
                {(j.aporteMes > 0 || j.rendMes > 0) && (
                  <div className="evol-card-badges">
                    {j.aporteMes > 0 && (
                      <span className="evol-badge evol-badge-aporte">
                        ＋ {brlCompact(j.aporteMes)} aportado
                      </span>
                    )}
                    {j.rendMes > 0 && (
                      <span className="evol-badge evol-badge-rend">
                        ＋ {brlCompact(j.rendMes)} em rendimentos
                      </span>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="evol-rodape">
          {temAnterior
            ? "Linha sólida = histórico real; linha tracejada = projeção baseada no seu ritmo de aporte e rentabilidade recente."
            : "Faça o upload de pelo menos 2 extratos para ver sua evolução real mês a mês. A projeção usa seu aporte médio."}
        </div>
      </div>
    </div>
  );
}
