/**
 * ResponsiveTable — tabela que vira lista de cards no mobile.
 *
 * Em desktop: <table> tradicional com header e linhas.
 * Em mobile (≤ 767px, via CSS em ui.css): cada <tr> vira um card,
 * o cabeçalho some e cada <td> mostra o label da coluna em pills antes
 * do valor (via data-label).
 *
 * Como usar:
 *   const cols = [
 *     { key: 'nome',   header: 'Cliente' },
 *     { key: 'valor',  header: 'Valor', align: 'right', render: r => brl(r.valor) },
 *     { key: 'status', header: 'Status' },
 *   ];
 *   <ResponsiveTable columns={cols} rows={clientes} rowKey={r => r.id}
 *                    onRowClick={r => navigate(`/cliente/${r.id}`)} />
 */
export function ResponsiveTable({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyState,
  className = "",
}) {
  if (!rows || rows.length === 0) {
    return emptyState || null;
  }

  const clickable = !!onRowClick;
  const tableClass = [
    "ui-table",
    clickable ? "ui-table--clickable" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className="ui-table-wrap">
      <table className={tableClass}>
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                className={col.align ? `align-${col.align}` : ""}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const key = rowKey ? rowKey(row, idx) : idx;
            return (
              <tr
                key={key}
                onClick={clickable ? () => onRowClick(row) : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={clickable ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(row);
                  }
                } : undefined}
                role={clickable ? "button" : undefined}
              >
                {columns.map(col => {
                  const value = col.render ? col.render(row) : row[col.key];
                  return (
                    <td
                      key={col.key}
                      data-label={col.header}
                      className={col.align ? `align-${col.align}` : ""}
                    >
                      {value}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default ResponsiveTable;
