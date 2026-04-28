# 📁 ASSETS - LOGO PORTO INVEST

## Estrutura de Logos

Este diretório contém todas as versões otimizadas do logo da Porto Invest.

### Arquivos Esperados

```
logo/
├── logo-icon.svg          (Apenas o símbolo "PI", quadrado, transparente)
├── logo-icon.png          (PNG 256x256, transparente, backup)
├── logo-text.svg          (Apenas o texto "PORTO INVEST", horizontal)
├── logo-text.png          (PNG, backup)
├── logo-full.svg          (Logo completo com símbolo + texto, horizontal)
├── logo-full.png          (PNG, backup)
├── logo-vertical.svg      (Logo símbolo sobre texto - para contextos verticais)
└── README.md              (Este arquivo)
```

## Especificações Técnicas

### Logo Icon (Símbolo PI)
- **Variantes**: SVG + PNG
- **Tamanho**: 
  - SVG: sem limite
  - PNG: 256x256 px
- **Fundo**: Transparente
- **Formato**: RGBA
- **Uso na Navbar**: 28px x 28px
- **Uso na Login**: 48px x 48px
- **Uso como icon**: 32px x 32px

### Logo Text (Texto PORTO INVEST)
- **Variantes**: SVG + PNG
- **Proporção**: Horizontal (maior largura)
- **Fundo**: Transparente
- **Uso**: Próximo ao ícone na navbar
- **Tamanho na Navbar**: 20px de altura

### Logo Full (Símbolo + Texto)
- **Variantes**: SVG + PNG
- **Layout**: Lado a lado (símbolo à esquerda, texto à direita)
- **Proporção**: Horizontal
- **Fundo**: Transparente
- **Uso**: Página de login (centralizado e maior)
- **Tamanho na Login**: 80px de altura

### Logo Vertical
- **Variantes**: SVG + PNG
- **Layout**: Símbolo acima, texto abaixo
- **Uso**: Cards, footers, contextos verticais
- **Fundo**: Transparente

## Otimização Requerida

### Remoção de Fundo
- [ ] Todas as imagens devem ter fundo transparente
- [ ] Sem caixa branca, cinza ou qualquer cor
- [ ] Apenas o elemento visual + transparência

### Formato SVG (Preferencial)
- [ ] Converter PNG → SVG usando ferramenta (ex: Vecterize, Potrace)
- [ ] SVG deve ser clean e minimal
- [ ] Remover comentários e espaços desnecessários
- [ ] Arquivo comprimido (SVGZ opcional)

### Tamanho de Arquivo
- [ ] PNG: máximo 50KB cada
- [ ] SVG: máximo 30KB cada
- [ ] Compressão sem perda de qualidade

### Resolução e DPI
- [ ] PNG: mínimo 256x256 (para retina, pode ser 512x512)
- [ ] SVG: sem limite de resolução (escala infinita)
- [ ] DPI: 72 DPI (web-ready)

## Como Adicionar os Logos

### Passo 1: Preparar as Imagens
1. Remover fundo das imagens originais
2. Salvar como PNG com transparência
3. Converter para SVG (opcional mas recomendado)

### Passo 2: Otimizar
1. Comprimir usando TinyPNG ou similar
2. Validar transparência
3. Testar em diferentes resoluções

### Passo 3: Organizar
1. Colocar arquivos nesta pasta `/src/assets/logo/`
2. Seguir a nomenclatura definida acima
3. Garantir nomes em minúscula com hífen (kebab-case)

### Passo 4: Validar
1. Testar na Navbar
2. Testar na Login
3. Testar responsividade
4. Verificar qualidade em retina displays

## Referência de Uso no Código

```jsx
// Na Navbar
<Logo variant="navbar" />

// Na Login
<Logo variant="login" />

// Apenas o ícone
<Logo variant="icon-only" />
```

## Checklist de Qualidade

- [ ] Sem fundo (transparente)
- [ ] Mantém proporção em todas as escalas
- [ ] SVG + PNG otimizados
- [ ] Arquivo < 50KB
- [ ] Nomes corretos (kebab-case)
- [ ] Testado em desktop
- [ ] Testado em mobile
- [ ] Testado em retina display
- [ ] Visualmente alinhado na navbar
- [ ] Alinhamento vertical perfeito

## Performance

- Lazy loading habilitado onde apropriado
- Imagens otimizadas para web
- Sem bloqueio de carregamento
- SVG preferível (sem HTTP request duplo)

---

**Status**: ⏳ Aguardando envio dos arquivos do logo

Quando os arquivos forem adicionados, este README será atualizado com checksums e mais detalhes.
