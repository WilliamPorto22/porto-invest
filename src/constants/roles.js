// Roles do sistema de autenticação multi-nível.
// Ver docs/PLANO_AUTH_MULTI_NIVEL.md para visão geral da hierarquia.

export const ROLES = Object.freeze({
  MASTER: "master",
  ASSESSOR: "assessor",
  CLIENTE: "cliente",
});

// Email do Master — usado como bootstrap antes do doc /users/{uid} existir
// (chicken-and-egg: a rota /dev/seed precisa de algum gate antes das roles serem populadas).
export const MASTER_EMAIL = "williamporto0@gmail.com";

// Lista de roles válidas, útil para validação em ProtectedRoute.
export const ALL_ROLES = Object.freeze([ROLES.MASTER, ROLES.ASSESSOR, ROLES.CLIENTE]);

// Helpers semânticos
export const isMasterRole = (role) => role === ROLES.MASTER;
export const isAssessorRole = (role) => role === ROLES.ASSESSOR;
export const isClienteRole = (role) => role === ROLES.CLIENTE;
