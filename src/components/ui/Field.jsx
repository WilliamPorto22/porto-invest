import { useId, useState } from "react";

/**
 * Field — input + label + error/help, com suporte a ícones e password toggle.
 *
 * Props principais:
 *   label, helpText, error, leadingIcon, trailing, type, ...input props
 *   togglePassword: se true e type="password", mostra botão de olho.
 */
export function Field({
  id,
  label,
  helpText,
  error,
  leadingIcon,
  trailing,
  togglePassword = false,
  type = "text",
  className = "",
  inputClassName = "",
  ...inputProps
}) {
  const reactId = useId();
  const inputId = id || reactId;
  const errorId = error ? `${inputId}-error` : undefined;
  const helpId = helpText && !error ? `${inputId}-help` : undefined;

  const [reveal, setReveal] = useState(false);
  const isPasswordWithToggle = togglePassword && type === "password";
  const effectiveType = isPasswordWithToggle && reveal ? "text" : type;

  const wrapperClasses = [
    "ui-field",
    error ? "ui-field--invalid" : "",
    leadingIcon ? "ui-field--with-leading-icon" : "",
    (trailing || isPasswordWithToggle) ? "ui-field--with-trailing" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className={wrapperClasses}>
      {label && (
        <label className="ui-field-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <div className="ui-field-control">
        {leadingIcon && (
          <span className="ui-field-leading-icon" aria-hidden="true">{leadingIcon}</span>
        )}
        <input
          id={inputId}
          type={effectiveType}
          className={`ui-field-input ${inputClassName}`.trim()}
          aria-invalid={!!error || undefined}
          aria-describedby={errorId || helpId}
          {...inputProps}
        />
        {(trailing || isPasswordWithToggle) && (
          <span className="ui-field-trailing">
            {isPasswordWithToggle && (
              <button
                type="button"
                onClick={() => setReveal(v => !v)}
                aria-label={reveal ? "Ocultar senha" : "Mostrar senha"}
                title={reveal ? "Ocultar senha" : "Mostrar senha"}
                className="login-pass-toggle"
              >
                {reveal ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            )}
            {trailing}
          </span>
        )}
      </div>
      {error && (
        <div id={errorId} className="ui-field-error" role="alert">
          {error}
        </div>
      )}
      {helpText && !error && (
        <div id={helpId} className="ui-field-help">
          {helpText}
        </div>
      )}
    </div>
  );
}

export default Field;
