import { useEffect, useState } from "react";

// Retorna true se a largura da janela estiver abaixo do breakpoint (padrão 640px).
// Reage a `resize`. Usa SSR-safe default (false) quando `window` não existe.
export function useIsMobile(bp = 640) {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < bp);
  useEffect(() => {
    const on = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [bp]);
  return m;
}

// Retorna true se a largura da janela estiver acima do breakpoint (padrão 1100px).
export function useIsWide(bp = 1100) {
  const [w, setW] = useState(() => typeof window !== "undefined" && window.innerWidth >= bp);
  useEffect(() => {
    const on = () => setW(window.innerWidth >= bp);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [bp]);
  return w;
}
