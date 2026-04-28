import { useMemo, useState } from "react";
import { brl } from "../../utils/currency";
import {
  TAXA_ANUAL,
  IPCA_ANUAL,
  encontrarAnosNecessarios,
} from "../../utils/objetivosCalc";

/**
 * SliderAcelerar — "E se eu aportar mais?"
 *
 * Slider interativo que mostra em tempo real quanto a liberdade financeira
 * acelera para cada R$ a mais aportado por mês. Pure simulation, não persiste.
 *
 * Props:
 *   patrimonio       — patrimônio atual do cliente (reais)
 *   metaLiberdade    — meta de aposentadoria (reais)
 *   aporteAtual      — aporte mensal total atual (reais)
 *   anosAtuais       — anos pra liberdade no ritmo atual (já calculado lá fora)
 */
export default function SliderAcelerar({
  patrimonio,
  metaLiberdade,
  aporteAtual,
  anosAtuais,
}) {
  // Estado vazio: sem meta ou sem aporte → mostrar prompt
  const semDados = metaLiberdade <= 0 || aporteAtual <= 0;

  // Range do slider: do aporte atual até max(3x, atual+5000)
  const max = useMemo(() => {
    return Math.max(aporteAtual * 3, aporteAtual + 5000, 1000);
  }, [aporteAtual]);

  const [aporteSim, setAporteSim] = useState(aporteAtual);

  // Recalcula anos com aporte simulado
  const anosSimulados = useMemo(() => {
    if (semDados) return null;
    if (patrimonio >= metaLiberdade) return 0;
    const anos = encontrarAnosNecessarios(
      patrimonio, aporteSim, metaLiberdade,
      { taxaAnual: TAXA_ANUAL, ipcaAnual: IPCA_ANUAL, maxAnos: 80 }
    );
    return anos != null ? Math.ceil(anos) : null;
  }, [patrimonio, aporteSim, metaLiberdade, semDados]);

  if (semDados) return null; // Esconde quando não há base pra simular

  const anoAtualCalendario = new Date().getFullYear();
  const anoAtual = anosAtuais != null ? anoAtualCalendario + anosAtuais : null;
  const anoSim = anosSimulados != null ? anoAtualCalendario + anosSimulados : null;
  const diffAnos = (anosAtuais != null && anosSimulados != null)
    ? anosAtuais - anosSimulados
    : null;
  const diffAporte = aporteSim - aporteAtual;

  // % do slider preenchido (0-100)
  const pct = max > aporteAtual
    ? Math.round(((aporteSim - aporteAtual) / (max - aporteAtual)) * 100)
    : 0;

  return (
    <div className="liberdade-section">
      <div className="liberdade-section-header">
        <span>Acelere sua liberdade</span>
        <div className="liberdade-section-divider" />
        <span className="liberdade-section-count">simulação</span>
      </div>

      <div className="acelerar-card">
        {/* Linha do slider */}
        <div className="acelerar-slider-row">
          <div className="acelerar-slider-label">Aporte mensal</div>
          <div className="acelerar-slider-valor">
            {brl(aporteSim)}
            <span className="acelerar-slider-mensal">/mês</span>
          </div>
        </div>

        <div className="acelerar-slider-wrap">
          <input
            type="range"
            min={aporteAtual}
            max={max}
            step={50}
            value={aporteSim}
            onChange={(e) => setAporteSim(parseFloat(e.target.value))}
            className="acelerar-slider"
            style={{
              background: `linear-gradient(90deg, #F0A202 0%, #F0A202 ${pct}%, rgba(255,255,255,0.06) ${pct}%, rgba(255,255,255,0.06) 100%)`
            }}
          />
          <div className="acelerar-slider-marks">
            <span>{brl(aporteAtual)}</span>
            <span className="acelerar-slider-mark-mid">arraste →</span>
            <span>{brl(max)}</span>
          </div>
        </div>

        {/* Comparativo antes/depois */}
        <div className="acelerar-compare">
          <div className="acelerar-col acelerar-col-now">
            <div className="acelerar-col-label">Hoje</div>
            <div className="acelerar-col-aporte">{brl(aporteAtual)}/mês</div>
            <div className="acelerar-col-divider" />
            <div className="acelerar-col-eyebrow">Liberdade em</div>
            <div className="acelerar-col-ano">
              {anoAtual ?? "—"}
            </div>
            <div className="acelerar-col-anos">
              {anosAtuais != null ? `${anosAtuais} anos` : "50+ anos"}
            </div>
          </div>

          <div className="acelerar-arrow" aria-hidden="true">→</div>

          <div className="acelerar-col acelerar-col-sim">
            <div className="acelerar-col-label">
              {diffAporte > 0 ? `Com +${brl(diffAporte)}/mês` : "No mesmo ritmo"}
            </div>
            <div className="acelerar-col-aporte">{brl(aporteSim)}/mês</div>
            <div className="acelerar-col-divider" />
            <div className="acelerar-col-eyebrow">Liberdade em</div>
            <div className="acelerar-col-ano acelerar-col-ano-gold">
              {anoSim ?? "—"}
            </div>
            <div className="acelerar-col-anos">
              {anosSimulados != null ? `${anosSimulados} anos` : "50+ anos"}
            </div>
          </div>
        </div>

        {/* Diff destacado */}
        {diffAnos != null && diffAnos > 0 && (
          <div className="acelerar-diff">
            <span className="acelerar-diff-emoji">🎉</span>
            <span>
              <b>{diffAnos} {diffAnos === 1 ? "ano" : "anos"} mais cedo</b>
              {" "}guardando apenas {brl(diffAporte)} a mais por mês
            </span>
          </div>
        )}

        {diffAnos === 0 && diffAporte > 0 && (
          <div className="acelerar-diff acelerar-diff-flat">
            <span>Pequena diferença. Tente aumentar mais o slider.</span>
          </div>
        )}
      </div>
    </div>
  );
}
