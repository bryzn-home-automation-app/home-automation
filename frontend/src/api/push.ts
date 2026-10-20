import api from './client';

/** The server's VAPID public key (base64url), needed to subscribe this device. */
export async function fetchPushPublicKey(): Promise<string> {
  const { data } = await api.get<{ publicKey: string }>('/push/public-key');
  return data.publicKey;
}

/** Register this device's PushSubscription (its toJSON() shape). */
export async function savePushSubscription(sub: PushSubscriptionJSON): Promise<void> {
  await api.post('/push/subscriptions', sub);
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await api.delete('/push/subscriptions', { params: { endpoint } });
}

export async function fetchPushStatus(endpoint: string): Promise<boolean> {
  const { data } = await api.get<{ subscribed: boolean }>('/push/subscriptions/status', { params: { endpoint } });
  return !!data.subscribed;
}

/** Send a test alert to all of the caller's devices; returns how many accepted it. */
export async function sendTestPush(): Promise<number> {
  const { data } = await api.post<{ delivered: number }>('/push/test');
  return data.delivered ?? 0;
}
