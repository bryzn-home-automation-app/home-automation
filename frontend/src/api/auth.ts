import api from './client';

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

export interface GuestLoginRequest {
  displayName: string;
  accentColor?: string;
  avatarUrl?: string;
}

export interface LoginResponse {
  token: string;
  userId: number;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'USER' | 'GUEST';
  phone?: string | null;
  avatarUrl?: string | null;
  accentColor?: string | null;
}

export interface ProfileResponse {
  id: number;
  username: string;
  email: string;
  displayName: string;
  phone: string | null;
  avatarUrl: string | null;
  accentColor: string;
  role: string;
  status: string;
}

export interface ProfileUpdateRequest {
  displayName?: string;
  phone?: string;
  avatarUrl?: string;
  accentColor?: string;
}

export interface AdminUser {
  id: number;
  email: string;
  username: string;
  displayName: string;
  role: string;
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'DISABLED' | 'EXPIRED';
  lastLoginAt: string | null;
  loginCount: number;
  createdAt: string;
  approvedAt: string | null;
  isOnline: boolean;
  avatarUrl: string | null;
  accentColor: string | null;
}

export interface GuestSession {
  id: number;
  userId: number;
  guestName: string;
  ipAddress: string;
  userAgent: string;
  connectedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  connectionCount: number;
}

// ── Auth ──

export async function login(req: LoginRequest): Promise<LoginResponse> {
  const { data } = await api.post('/auth/login', req);
  return data;
}

export async function register(req: RegisterRequest): Promise<AdminUser> {
  const { data } = await api.post('/auth/register', req);
  return data;
}

export async function guestLogin(req: GuestLoginRequest, code?: string): Promise<LoginResponse> {
  const { data } = await api.post('/auth/guest-login', req, {
    params: code ? { code } : undefined,
  });
  return data;
}

export async function fetchGuestInviteCode(): Promise<string> {
  const { data } = await api.get('/auth/guest-invite-code');
  return data.code;
}

/** What the sign-in page offers (GET /api/auth/oidc/config). */
export interface SignInOptions {
  /** "Sign in with Home" (home SSO). */
  enabled: boolean;
  /** The retired password form, switched back on (an emergency switch on the server). */
  passwordLogin: boolean;
  /** "Forgot password?": a member sets a new Home password with their birthday. */
  passwordReset?: boolean;
  /** Home's shortest allowed password (Authelia's policy). */
  passwordMinLength?: number;
}

export async function oidcConfig(): Promise<SignInOptions> {
  const { data } = await api.get('/auth/oidc/config');
  return data;
}

/** Full-page navigation to home SSO: the server redirects on to the home sign-in page. */
export function startHomeSso(): void {
  window.location.assign('/api/auth/oidc/start');
}

/**
 * Back from home SSO (/login?sso=1): swaps the one-time code, which the server put in an HttpOnly
 * cookie for this browser, for the usual login response.
 */
export async function oidcExchange(): Promise<LoginResponse> {
  const { data } = await api.post('/auth/oidc/exchange');
  return data;
}

export interface ResetPasswordRequest {
  username: string;
  /** yyyy-MM-dd */
  birthDate: string;
  newPassword: string;
}

/**
 * "Forgot password?": a member proves who they are with the birthday the admin stored for them and
 * chooses a new Home password (the one Sign in with Home asks for, in every home app).
 * Errors: 400 bad input (the message says what), 401 no match (always the same answer), 429 too
 * many tries (`retryAfterSeconds`), 404 switched off, 503 unavailable.
 */
export async function resetPassword(req: ResetPasswordRequest): Promise<void> {
  await api.post('/auth/reset-password', req);
}

export async function fetchMe(): Promise<LoginResponse> {
  const { data } = await api.get('/auth/me');
  return data;
}

export async function heartbeat(): Promise<void> {
  await api.post('/auth/heartbeat');
}

// ── Admin ──

export async function fetchAllUsers(): Promise<AdminUser[]> {
  const { data } = await api.get('/auth/users');
  return data;
}

export async function fetchPendingUsers(): Promise<AdminUser[]> {
  const { data } = await api.get('/admin/users/pending');
  return data;
}

export async function fetchPendingCount(): Promise<number> {
  const { data } = await api.get('/admin/users/pending/count');
  return data.count;
}

export async function approveUser(userId: number, role: string): Promise<AdminUser> {
  const { data } = await api.post(`/admin/users/${userId}/approve`, { role });
  return data;
}

export async function denyUser(userId: number): Promise<void> {
  await api.post(`/admin/users/${userId}/deny`);
}

export async function updateUserRole(userId: number, role: string): Promise<AdminUser> {
  const { data } = await api.put(`/admin/users/${userId}/role`, { role });
  return data;
}

export async function disableUser(userId: number): Promise<void> {
  await api.post(`/admin/users/${userId}/disable`);
}

export async function reactivateUser(userId: number): Promise<void> {
  await api.post(`/admin/users/${userId}/reactivate`);
}

/** A stored reset birthday (admins only; no other API ever returns one). */
export interface UserBirthday {
  userId: number;
  /** yyyy-MM-dd */
  birthDate: string;
}

export async function fetchBirthdays(): Promise<UserBirthday[]> {
  const { data } = await api.get('/admin/users/birthdays');
  return data;
}

/** Set (members only) or, with null, clear the birthday a member resets their password with. */
export async function setBirthday(userId: number, birthDate: string | null): Promise<UserBirthday> {
  const { data } = await api.put(`/admin/users/${userId}/birthday`, { birthDate });
  return data;
}

/** Lifts a member's "Forgot password?" pause: clears their wrong-try counts (admins only). */
export async function clearResetTries(userId: number): Promise<void> {
  await api.delete(`/admin/users/${userId}/reset-tries`);
}

export async function fetchGuestSessions(): Promise<GuestSession[]> {
  const { data } = await api.get('/admin/guest-sessions');
  return data;
}

export async function fetchGuestSessionCount(): Promise<number> {
  const { data } = await api.get('/admin/guest-sessions/count');
  return data.count;
}

export async function expireGuestSessions(): Promise<void> {
  await api.post('/admin/guest-sessions/expire');
}

export async function fetchAdminStats(): Promise<{
  activeGuests: number;
  pendingApprovals: number;
  timestamp: number;
}> {
  const { data } = await api.get('/admin/stats');
  return data;
}

// ── Profile ──

export async function fetchProfile(): Promise<ProfileResponse> {
  const { data } = await api.get('/auth/profile');
  return data;
}

export async function updateProfile(req: ProfileUpdateRequest): Promise<ProfileResponse> {
  const { data } = await api.put('/auth/profile', req);
  return data;
}

// ── Upload ──

export async function uploadAvatar(file: File): Promise<{ avatarUrl: string }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/upload/avatar', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}
