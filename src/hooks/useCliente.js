import { useEffect, useState, useCallback } from "react";
import {
  lerClienteComFallback,
  invalidarCacheCliente,
} from "../services/lerClienteFallback";

/**
 * useCliente — encapsula a leitura de /clientes/{clienteId} via lerClienteComFallback.
 *
 * Substitui o boilerplate repetido em 11+ pages/components:
 *   const [cliente, setCliente] = useState(null);
 *   const [loading, setLoading] = useState(true);
 *   useEffect(() => {
 *     let alive = true;
 *     lerClienteComFallback(id, { isAlive: () => alive })...
 *     return () => { alive = false; };
 *   }, [id]);
 *
 * O service em si (lerClienteFallback.js) ja faz cache em 3 camadas
 * (memoria + localStorage + dedupe), retry com Cloud Function e flag de
 * direct-blocked. Esse hook so fornece o ciclo de vida React + estado.
 *
 * @param {string|null|undefined} clienteId - quando vazio, hook nao fetcha
 *   e retorna cliente: null, loading: false.
 * @returns {{
 *   cliente: object|null,        // dados do doc (ou null antes de resolver / quando exists=false)
 *   exists: boolean|null,        // null antes da primeira resolucao; true/false depois
 *   loading: boolean,            // true durante fetch
 *   erro: Error|null,            // erro do ultimo fetch (excluindo abort)
 *   recarregar: () => Promise,   // invalida cache + refetch (uso apos save)
 * }}
 */
export function useCliente(clienteId) {
  const [cliente, setCliente] = useState(null);
  const [exists, setExists] = useState(null);
  const [loading, setLoading] = useState(!!clienteId);
  const [erro, setErro] = useState(null);
  // forceTick incrementa pra disparar re-fetch via recarregar()
  const [forceTick, setForceTick] = useState(0);

  useEffect(() => {
    if (!clienteId) {
      setCliente(null);
      setExists(null);
      setLoading(false);
      setErro(null);
      return undefined;
    }

    let alive = true;
    setLoading(true);
    setErro(null);

    lerClienteComFallback(clienteId, {
      isAlive: () => alive,
      force: forceTick > 0,
    })
      .then((r) => {
        if (!alive) return;
        setCliente(r.data || null);
        setExists(!!r.exists);
      })
      .catch((e) => {
        if (!alive) return;
        if (e?.message === "aborted") return;
        setErro(e);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [clienteId, forceTick]);

  const recarregar = useCallback(async () => {
    if (!clienteId) return;
    invalidarCacheCliente(clienteId);
    setForceTick((n) => n + 1);
  }, [clienteId]);

  return { cliente, exists, loading, erro, recarregar };
}
