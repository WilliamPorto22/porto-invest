/**
 * Button — componente de botão padrão do design system.
 *
 * Variantes: primary | secondary | ghost | danger
 * Tamanhos:  sm | md | lg
 * Props extras:
 *   - block:    largura 100%
 *   - loading:  desabilita e mostra spinner (mantém a label)
 *   - leftIcon, rightIcon: nodes opcionais
 *   - as:       opcional para renderizar como outro elemento (ex: "a")
 *
 * Exemplo:
 *   <Button variant="primary" size="lg" block onClick={...}>Entrar</Button>
 */
export function Button({
  variant = "primary",
  size = "md",
  block = false,
  loading = false,
  leftIcon,
  rightIcon,
  as: Comp = "button",
  className = "",
  type = "button",
  disabled = false,
  children,
  ...rest
}) {
  const classes = [
    "ui-btn",
    `ui-btn--${variant}`,
    `ui-btn--${size}`,
    block ? "ui-btn--block" : "",
    className,
  ].filter(Boolean).join(" ");

  const extraProps = Comp === "button" ? { type, disabled: disabled || loading } : {};

  return (
    <Comp
      className={classes}
      data-loading={loading ? "true" : undefined}
      aria-busy={loading || undefined}
      {...extraProps}
      {...rest}
    >
      {loading ? <span className="ui-btn-spinner" aria-hidden="true" /> : leftIcon}
      <span>{children}</span>
      {!loading && rightIcon}
    </Comp>
  );
}

export default Button;
