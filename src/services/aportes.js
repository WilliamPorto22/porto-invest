import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { parseCentavos } from "../utils/currency";
import { stripUndefined } from "./snapshotsCarteira";

/**
 * Service de aportes — cálculo de status e registro simplificado.
 *
 * Reusa o schema legado (não cria collection nova):
 *   clientes/{id}.diaAporte             → "1"…"31" (string, dia do mês combinado)
 *   clientes/{id}.metaAporteMensal      → centavos string (meta mensal)
 *   clientes/{id}.aportesHistorico      → array { mes, ano, tipo, valor, data, feitoPor? }
 *   clientes/{id}.aporteRegistradoMes   → centavos string (acumulado do mês corrente)
 *   clientes/{id}.aporte                → centavos string (acumulado total)
 *   clientes/{id}.lastAporteDate        → ISO date
 *
 * O assessor já lê tudo isso no Mapa de Aportes da ficha; aportes registrados
 * pelo cliente aparecem lá automaticamente.
 */

/**
 * Calcula o status do aporte do mês corrente.
 * @param {object} cliente  doc completo do cliente.
 * @param {Date}   [hoje]   pra testes; default = new Date().
 * @returns {object}
 *   status: 'nao_combinado' | 'em_dia' | 'parcial' | 'pendente' | 'atrasado'
 *   mesLabel:        ex.: "Novembro"
 *   mesAno:          ex.: { mes: 11, ano: 2026 }
 *   valorMetaMes:    reais (number) — 0 se não houver meta
 *   valorRegistrado: reais (number)
 *   diaCombinado:    int 1-31 ou null
 *   diasParaVencer:  int (>0) quando pendente
 *   diasAtraso:      int (>0) quando atrasado
 */
export function getStatusAporteMes(cliente, hoje = new Date()) {
  const mes = hoje.getMonth() + 1;
  const ano = hoje.getFullYear();
  const mesLabel = hoje.toLocaleDateString("pt-BR", { month: "long" })
    .replace(/^./, (c) => c.toUpperCase());

  const diaCombinado = cliente?.diaAporte ? parseInt(cliente.diaAporte, 10) : null;
  const valorMetaMes = parseCentavos(cliente?.metaAporteMensal) / 100;

  // Soma o que já foi registrado neste mês (aportesHistorico)
  const hist = Array.isArray(cliente?.aportesHistorico) ? cliente.aportesHistorico : [];
  const valorRegistrado = hist
    .filter((a) => Number(a?.mes) === mes && Number(a?.ano) === ano)
    .reduce((acc, a) => acc + parseCentavos(a?.valor) / 100, 0);

  const base = { mesLabel, mesAno: { mes, ano }, valorMetaMes, valorRegistrado, diaCombinado };

  // Sem dia combinado: nada pra cobrar.
  if (!diaCombinado || diaCombinado < 1 || diaCombinado > 31) {
    return { ...base, status: "nao_combinado" };
  }

  // Já registrou algo neste mês?
  if (valorRegistrado > 0) {
    if (valorMetaMes > 0 && valorRegistrado < valorMetaMes * 0.9) {
      return { ...base, status: "parcial" };
    }
    return { ...base, status: "em_dia" };
  }

  // Não registrou: comparar dia atual vs combinado
  const diaHoje = hoje.getDate();
  if (diaHoje <= diaCombinado) {
    return { ...base, status: "pendente", diasParaVencer: diaCombinado - diaHoje };
  }
  return { ...base, status: "atrasado", diasAtraso: diaHoje - diaCombinado };
}

/**
 * Registra um aporte do cliente (versão simplificada — sem classe/ativo).
 *
 * Atualiza os mesmos campos que o fluxo do assessor usa, então a propagação
 * pro Mapa de Aportes / Extrato é automática. Marca `feitoPor: "cliente"`
 * pra rastreabilidade.
 *
 * @param {string} clienteId
 * @param {object} cliente   snapshot atual (pra somar ao acumulado)
 * @param {number} valorReais  ex.: 5000 (R$ 5.000,00)
 * @param {Date}   [hoje]
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function registrarAporteCliente(clienteId, cliente, valorReais, hoje = new Date()) {
  const reais = Math.round(Number(valorReais) || 0);
  if (reais <= 0) return { ok: false, error: "Valor inválido" };
  const centavos = reais * 100;

  const mes = hoje.getMonth() + 1;
  const ano = hoje.getFullYear();
  const dataPtBR = hoje.toLocaleDateString("pt-BR");
  const dataISO = hoje.toISOString();

  // Atualiza histórico consolidado por mês (somando se já tem registro do mês)
  const hist = Array.isArray(cliente?.aportesHistorico) ? [...cliente.aportesHistorico] : [];
  const idx = hist.findIndex((m) => Number(m?.mes) === mes && Number(m?.ano) === ano);
  const acumuladoMes = idx >= 0 ? parseCentavos(hist[idx].valor) + centavos : centavos;
  const mov = {
    mes, ano,
    tipo: "aporte",
    valor: String(acumuladoMes),
    data: dataPtBR,
    feitoPor: "cliente",
  };
  if (idx >= 0) hist[idx] = mov; else hist.push(mov);

  // Lista detalhada (Extrato)
  const aportes = Array.isArray(cliente?.aportes) ? [...cliente.aportes] : [];
  aportes.push({
    valor: String(centavos),
    data: dataISO,
    classe: "",
    classeLabel: "",
    classeCor: "",
    ativo: "",
    saldoRemanescente: "",
    descricao: "Aporte mensal · registrado pelo cliente",
    origem: "Cliente",
  });

  const novoAporteRegistradoMes = String(parseCentavos(cliente?.aporteRegistradoMes) + centavos);
  const novoAporteTotal = String(parseCentavos(cliente?.aporte) + centavos);

  try {
    await setDoc(doc(db, "clientes", clienteId), stripUndefined({
      aporteRegistradoMes: novoAporteRegistradoMes,
      aporte: novoAporteTotal,
      aportesHistorico: hist,
      aportes,
      lastAporteDate: dataISO,
    }), { merge: true });
    return { ok: true, valorRegistrado: reais, mes, ano };
  } catch (e) {
    return {
      ok: false,
      error: e?.code === "permission-denied"
        ? "Sem permissão para salvar. Faça logout e entre novamente."
        : (e?.message || "Erro ao registrar"),
    };
  }
}
