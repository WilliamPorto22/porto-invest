import { Component } from "react";

/**
 * SilentBoundary — Error boundary que retorna null em caso de erro
 * (sem fallback visual). Use pra envolver componentes não-críticos
 * (ex.: WhatsApp button) que NUNCA devem derrubar a árvore.
 */
export class SilentBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
     
    console.warn("[SilentBoundary]", error?.message, info?.componentStack);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
