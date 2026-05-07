// Tickers monitorados pelo cron de atualizacao de mercado.
// Espelha src/constants/mercadoUniverso.js (CLASSES). NAO da pra importar
// direto do src/ porque functions/ roda em Node sem o build do Vite.
// Manter sincronizado se a lista do client mudar.

const ACOES_BR = [
  'PETR4','VALE3','ITUB4','BBDC4','BBAS3','ABEV3','WEGE3','SUZB3','ELET3','B3SA3',
  'ITSA4','RENT3','PRIO3','RADL3','EQTL3','JBSS3','GGBR4','VIVT3','RAIL3','TIMS3',
  'EMBR3','UGPA3','CSAN3','VBBR3','HAPV3','RDOR3','LREN3','ASAI3','MGLU3','KLBN11',
  'BRFS3','CPLE6','TOTS3','SBSP3','CMIG4','CSNA3','CPFE3','EGIE3','BBSE3','PSSA3',
  'SANB11','MULT3','HYPE3','CYRE3','EZTC3','FLRY3','SLCE3','TAEE11','ENGI11','MRFG3',
  'ENEV3','BRAV3','ALOS3','CCRO3','SMTO3','CMIN3','CXSE3','LWSA3','POMO4','DXCO3',
];

const FIIS = [
  'HGLG11','BTLG11','VILG11','XPLG11','BRCO11','GGRC11','LVBI11','SDIL11',
  'HGBS11','XPML11','HSML11','VISC11','MALL11','HFOF11',
  'MXRF11','KNIP11','IRDM11','RECR11','RBRR11','HGCR11','KNCR11','VRTA11','KNHY11','CPTS11','RBRY11','BCFF11','RBVA11','FEXC11',
  'GARE11','TRXF11','RZTR11',
  'HGRE11','JSRE11','BRCR11','RCRB11','PVBI11','VINO11',
  'KNRI11','HGRU11','RBRP11','ALZR11','RBHG11','BBPO11','MGFF11',
  'HCTR11','RZAT11','RECT11','OUJP11','VGIP11','JPPA11','URPR11',
];

const ACOES_US = [
  'AAPL','MSFT','GOOGL','AMZN','META','NVDA','TSLA','AMD','AVGO','TSM',
  'ORCL','ADBE','CRM','NFLX','DIS','INTC','CSCO','TXN','QCOM','IBM',
  'JPM','BAC','WFC','GS','MS','V','MA','BRK-B',
  'JNJ','UNH','LLY','ABBV','MRK','PFE','ABT','TMO',
  'WMT','COST','HD','MCD','KO','PEP','PG',
  'XOM','CVX',
  'CAT','BA','GE','HON','LMT','RTX',
];

const REITS = [
  'AMT','CCI','SBAC',
  'PLD','STAG','EGP','FR',
  'EQIX','DLR',
  'PSA','EXR','CUBE','NSA',
  'WELL','VTR','DOC','OHI','MPW',
  'O','SPG','REG','FRT','KIM','BRX','MAC','ADC','EPR','VICI',
  'AVB','EQR','ESS','MAA','UDR','CPT','INVH','AMH','ELS','SUI',
  'ARE','BXP','KRC','VNO','SLG','HPP',
  'HST',
  'WPC','IRM','LAMR','COLD','GLPI',
];

module.exports = {
  TICKERS_BR: [...ACOES_BR, ...FIIS],
  TICKERS_US: [...ACOES_US, ...REITS],
};
