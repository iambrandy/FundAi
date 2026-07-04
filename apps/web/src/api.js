// FundAI API Client
// Thin wrapper around fetch — stores token in localStorage, injects it on every
// authenticated request, and throws on non-2xx so callers can .catch uniformly.

const BASE = "/api";

function getToken() {
  return localStorage.getItem("fundai_token");
}

export function setToken(token) {
  localStorage.setItem("fundai_token", token);
}

export function clearToken() {
  localStorage.removeItem("fundai_token");
  localStorage.removeItem("fundai_user");
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("fundai_user") || "null");
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  localStorage.setItem("fundai_user", JSON.stringify(user));
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err = new Error(body.error || "Request failed");
    err.status = res.status;
    throw err;
  }

  return res.json();
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function login(email, password) {
  const data = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  setStoredUser(data.user);
  return data;
}

export async function signup(email, password, fullName, role) {
  const data = await request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, fullName, role }),
  });
  setToken(data.token);
  setStoredUser(data.user);
  return data;
}

// ─── Clients ─────────────────────────────────────────────────────────────────

export async function getClients() {
  return request("/clients");
}

export async function getClient(clientId) {
  return request(`/clients/${clientId}`);
}

export async function createClient(data) {
  return request("/clients", { method: "POST", body: JSON.stringify(data) });
}

// ─── Portfolios ──────────────────────────────────────────────────────────────

export async function getPortfolio(portfolioId) {
  return request(`/portfolios/${portfolioId}`);
}

export async function createPortfolio(data) {
  return request("/portfolios", { method: "POST", body: JSON.stringify(data) });
}

// ─── Recommendations ─────────────────────────────────────────────────────────

export async function getRecommendations(portfolioId) {
  return request(`/recommendations/portfolio/${portfolioId}`);
}

export async function decideRecommendation(recommendationId, decision) {
  return request(`/recommendations/${recommendationId}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

// ─── Market Intelligence ─────────────────────────────────────────────────────

export async function getMarketRegime() {
  return request("/market/regime");
}

export async function getFactorPerformance() {
  return request("/market/factor-performance");
}
