/**
 * Card — wrapper visual base.
 *
 * Props:
 *   - padding: "sm" | "md" (default) | "lg"
 *   - interactive: hover lift + border dourada
 *   - glow: gradient sutil dourado no canto superior direito
 *
 * Subcomponentes nomeados:
 *   <CardHeader>, <CardTitle>, <CardSubtitle>, <CardFooter>
 *
 * Uso:
 *   import { Card, CardHeader, CardTitle, CardFooter } from "@/components/ui";
 */
export function Card({
  padding = "md",
  interactive = false,
  glow = false,
  className = "",
  children,
  ...rest
}) {
  const classes = [
    "ui-card",
    padding === "sm" ? "ui-card--padded-sm" : "",
    padding === "lg" ? "ui-card--padded-lg" : "",
    interactive ? "ui-card--interactive" : "",
    glow ? "ui-card--glow" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ className = "", children, ...rest }) {
  return (
    <div className={`ui-card-header ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ className = "", children, ...rest }) {
  return (
    <h3 className={`ui-card-title ${className}`.trim()} {...rest}>
      {children}
    </h3>
  );
}

export function CardSubtitle({ className = "", children, ...rest }) {
  return (
    <p className={`ui-card-subtitle ${className}`.trim()} {...rest}>
      {children}
    </p>
  );
}

export function CardFooter({ className = "", children, ...rest }) {
  return (
    <div className={`ui-card-footer ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export default Card;
