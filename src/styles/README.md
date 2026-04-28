# WealthTrack - Estilos Responsivos

## Estrutura de Estilos

Este diretório contém a organização centralizada de estilos CSS para o projeto WealthTrack.

### Arquivos

- **globals.css** - Variáveis CSS, reset global, utilitários base
- **responsive.css** - Media queries para responsividade (mobile, tablet, desktop)
- **components.css** - Estilos de componentes extraídos das páginas

### Variáveis CSS Disponíveis

Todas as cores, espaçamentos e raios do design estão definidos em `:root`:

```css
/* Cores */
--bg, --bg-card, --text-primary, --text-secondary, --gold, --success, --danger, etc.

/* Espaçamento */
--spacing-xs (4px), --spacing-sm (8px), --spacing-md (12px), --spacing-lg (16px), --spacing-xl (20px), --spacing-2xl (28px), --spacing-3xl (48px)

/* Breakpoints */
--mobile: 480px, --tablet: 768px, --desktop: 1024px
```

### Classes Responsivas para Grids

Todas as classes de grid são mobile-first:

```css
.grid-kpi          /* 1 col mobile → 2 col tablet → 4 col desktop */
.grid-clients      /* 1 col mobile → 2 col tablet → 4 col desktop */
.grid-alerts       /* 1 col mobile → auto-fit tablet/desktop */
.grid-objectives   /* 1 col mobile → 2 col tablet */
.grid-assets       /* 1 col mobile → 2 col tablet → 3 col desktop */
.grid-indicators   /* 1 col mobile → 5 col desktop */
```

---

## Refatoração Pendente

Três páginas ainda precisam ser refatoradas de forma similar:

### 1. **Carteira.jsx** (78 estilos inline)

**Componentes principais:**
- `GraficoPizza` - SVG com estilos inline (linhas 49-95)
- Tabela de ativos (linhas 334-399)
- KPIs de topo (linhas 334-345)

**Passos para refatorar:**
1. Extrair estilos da função `GraficoPizza` para classes CSS (`.grafico-pizza`, `.grafico-legenda`)
2. Refatorar tabela para classes (`.assets-table`, `.assets-table-header`, `.assets-table-row`)
3. Refatorar KPIs para usar `.kpi-card`
4. Adicionar responsive layout para gráfico + tabela lado a lado → empilhado em mobile

**Classes CSS a criar:**
```css
.carteira-container
.carteira-content
.carteira-header
.grafico-pizza
.grafico-pizza-empty
.grafico-legenda
.assets-table
.assets-table-header
.assets-table-row
.alert-feedback
.alert-removal
```

### 2. **Objetivos.jsx** (95 estilos inline)

**Componentes principais:**
- Grid de tipos de objetivos (2 colunas) - linhas 268-276
- Cards de objetivos coloridos
- Recalibração com inputs nested
- Status pills coloridos

**Passos para refatorar:**
1. Converter grid de tipos para `.grid-objectives`
2. Extrair estilos de cards de objetivo
3. Refatorar modal de recalibração
4. Usar data attributes para cores dinâmicas: `[data-color="blue"]`

**Classes CSS a criar:**
```css
.objetivos-container
.objetivos-content
.objetivo-card
.objetivo-card-header
.objetivo-types-grid
.objetivo-pill
.recalibration-modal
.recalibration-inputs
.status-badge
```

### 3. **ClienteFicha.jsx** (92 estilos inline - MAIOR)

**Componentes principais:**
- Cards de cliente
- Dividers com espaço
- Modal de novo objetivo
- Inputs customizados
- Custom Select dropdown
- Abas (tabs)

**Passos para refatorar:**
1. Extrair `CARD_STYLE` para classe `.card`
2. Refatorar modal para `.modal-overlay` e `.modal-content`
3. Extrair inputs para `.form-input`, `.form-textarea`
4. Refatorar Custom Select para classes CSS
5. Implementar abas (tabs) com CSS

**Classes CSS a criar:**
```css
.clienteficha-container
.clienteficha-content
.clienteficha-tabs
.clienteficha-tab-panel
.modal-overlay
.modal-content
.custom-select
.custom-select-trigger
.custom-select-menu
.objetivo-form
```

---

## Padrões de Refatoração

### Pattern 1: Converter estilos inline para classe

**Antes:**
```jsx
<div style={{background: T.bgCard, border: `0.5px solid ${T.border}`, padding: "20px"}}>
```

**Depois:**
```jsx
<div className="card">
```

E em `components.css`:
```css
.card {
  background: var(--bg-card);
  border: 0.5px solid var(--border);
  padding: var(--spacing-xl);
}
```

### Pattern 2: Cores dinâmicas com data attributes

**Antes:**
```jsx
<div style={{color: status === "ok" ? "#22c55e" : "#ef4444"}}>
```

**Depois:**
```jsx
<div className="status-badge" data-status={status}>
```

E em `components.css`:
```css
.status-badge {
  padding: 4px 12px;
  border-radius: 20px;
}

[data-status="ok"] {
  background: var(--success-dim);
  color: var(--success);
}

[data-status="error"] {
  background: var(--danger-dim);
  color: var(--danger);
}
```

### Pattern 3: Responsive layouts

**Mobile-first grid:**
```css
.grid-clients {
  display: grid;
  grid-template-columns: 1fr;  /* Mobile */
  gap: var(--spacing-lg);
}

@media (min-width: 480px) {
  .grid-clients {
    grid-template-columns: repeat(2, 1fr);  /* Tablet */
  }
}

@media (min-width: 768px) {
  .grid-clients {
    grid-template-columns: repeat(4, 1fr);  /* Desktop */
  }
}
```

### Pattern 4: Flexível para mobile

**Antes (flex lado a lado):**
```jsx
<div style={{display: "flex", gap: 24}}>
  <GraficoPizza />
  <Tabela />
</div>
```

**Depois (empilhado em mobile):**
```jsx
<div className="flex-responsive">
  <GraficoPizza />
  <Tabela />
</div>
```

```css
.flex-responsive {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

@media (min-width: 768px) {
  .flex-responsive {
    flex-direction: row;
    gap: var(--spacing-2xl);
  }
}
```

---

## Testing Responsiveness

Após refatorar cada página, testar em:

1. **Mobile (375px)** - iPhone SE
2. **Tablet (768px)** - iPad
3. **Desktop (1024px+)** - Monitor

Checklist:
- ✅ Sem overlapping de texto/números
- ✅ Grids colapsam para single column em mobile
- ✅ Padding/margin se ajustam
- ✅ Buttons com min-height: 44px (tap-friendly)
- ✅ Inputs legíveis e acessíveis
- ✅ Nenhum console error

---

## Próximos Passos

1. Refatorar **Carteira.jsx** seguindo patterns acima
2. Refatorar **Objetivos.jsx**
3. Refatorar **ClienteFicha.jsx**
4. Testar responsividade em todos os breakpoints
5. Verificar performance e acessibilidade

---

## Dúvidas?

Todas as cores e valores estão em `theme.js` (T object) e em `globals.css` (variáveis CSS).
Manter consistência usando variáveis em vez de hardcoding valores!
