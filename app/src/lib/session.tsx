import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api, ApiError, normalizeUrl, setApiConfig, type Health } from './api';
import {
  applyRemote,
  clearOps,
  getMeta,
  getPhotoSettings,
  listEvents,
  pendingCount,
  pendingOps,
  setMeta,
  wipeLocalData,
} from './db';
import { rescheduleNotifications } from './notify';
import { cleanupOldPhotos } from './photo';
import type { DeviceInfo } from './types';

const KEY_URL = 'hub.baseUrl';
const KEY_TOKEN = 'hub.token';
const KEY_DEVICE = 'hub.device';

type Status = 'loading' | 'unpaired' | 'pending' | 'ready';

type SessionValue = {
  status: Status;
  baseUrl: string | null;
  device: DeviceInfo | null;
  family: { id: string; name: string } | null;
  health: Health | null;
  lastSyncAt: number | null;
  outboxCount: number;
  syncing: boolean;
  syncError: string | null;
  connect: (input: { url: string; code: string; deviceName?: string }) => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
  refreshDevices: () => Promise<DeviceInfo[]>;
  approveDevice: (id: string) => Promise<void>;
  revokeDevice: (id: string) => Promise<void>;
  createInvite: () => Promise<{ code: string; expiresAt: number }>;
};

const SessionContext = createContext<SessionValue | null>(null);

/** Clears stored credentials. Never throws, so it is safe during startup. */
async function clearStoredSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_URL).catch(() => {}),
    SecureStore.deleteItemAsync(KEY_TOKEN).catch(() => {}),
    SecureStore.deleteItemAsync(KEY_DEVICE).catch(() => {}),
  ]);
  setApiConfig({ baseUrl: null, token: null });
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [family, setFamily] = useState<{ id: string; name: string } | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [outboxCount, setOutboxCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncingRef = useRef(false);

  const deviceName = useMemo(() => {
    if (Platform.OS === 'ios') return '아이폰';
    if (Platform.OS === 'android') return '안드로이드폰';
    return '기기';
  }, []);

  const signOutLocally = useCallback(async () => {
    await clearStoredSession();
    setBaseUrl(null);
    setDevice(null);
    setFamily(null);
    setHealth(null);
    setSyncError(null);
    setStatus('unpaired');
    await setMeta('cursor', '0').catch(() => {});
  }, []);

  const boot = useCallback(async () => {
    try {
      const [savedUrl, savedToken] = await Promise.all([
        withTimeout(SecureStore.getItemAsync(KEY_URL), 3000, null),
        withTimeout(SecureStore.getItemAsync(KEY_TOKEN), 3000, null),
      ]);
      if (!savedUrl || !savedToken) {
        setStatus('unpaired');
        return;
      }
      setBaseUrl(savedUrl);
      setApiConfig({ baseUrl: savedUrl, token: savedToken });

      const me = await api.me();
      setDevice(me.device);
      setFamily(me.family);

      if (me.device.status === 'revoked') {
        await signOutLocally();
        return;
      }
      if (me.device.status === 'pending') {
        setStatus('pending');
        return;
      }

      setStatus('ready');
      api.health().then(setHealth).catch(() => setHealth(null));
      const savedSync = await getMeta('lastSyncAt');
      setLastSyncAt(savedSync ? Number(savedSync) : null);
      setOutboxCount(await pendingCount());
    } catch (error) {
      try {
        if (error instanceof ApiError && error.status === 403) {
          const saved = await SecureStore.getItemAsync(KEY_DEVICE);
          if (saved) setDevice(JSON.parse(saved));
          setStatus('pending');
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          await signOutLocally();
          return;
        }
        // Server unreachable: stay usable offline.
        const saved = await SecureStore.getItemAsync(KEY_DEVICE);
        if (saved) setDevice(JSON.parse(saved));
        setStatus('ready');
        setSyncError('서버에 연결할 수 없습니다. 오프라인으로 사용 중입니다.');
        setOutboxCount(await pendingCount());
      } catch {
        // Storage/keystore failure must never block the app from opening.
        setStatus('unpaired');
      }
    }
  }, [signOutLocally]);

  useEffect(() => {
    // boot() only calls setState after awaiting storage/network, so this is not
    // a synchronous cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    boot();
    // Hard safety net: never leave the app stuck on the loading screen.
    const timer = setTimeout(() => {
      setStatus((current) => (current === 'loading' ? 'unpaired' : current));
    }, 6000);
    return () => clearTimeout(timer);
  }, [boot]);

  const syncNow = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const cursor = Number((await getMeta('cursor')) ?? '0');
      const ops = await pendingOps();
      const result = await api.sync({ cursor, ops });
      await applyRemote(result.changes);
      const settled = [...result.applied, ...result.rejected.map((item) => item.opId)];
      await clearOps(settled);
      await setMeta('cursor', String(result.cursor));
      const successAt = Date.now();
      await setMeta('lastSyncAt', String(successAt));
      setLastSyncAt(successAt);
      setOutboxCount(await pendingCount());
      setSyncError(null);
      const photoSettings = await getPhotoSettings();
      await cleanupOldPhotos(photoSettings);
      const upcoming = await listEvents(new Date().toISOString());
      await rescheduleNotifications(upcoming);
    } catch (error) {
      setSyncError((error as Error).message);
      setOutboxCount(await pendingCount());
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, []);

  const connect = useCallback(
    async (input: { url: string; code: string; deviceName?: string }) => {
      const url = normalizeUrl(input.url);
      setApiConfig({ baseUrl: url, token: null });
      const healthCheck = await api.health();
      setHealth(healthCheck);
      const result = await api.pair({
        code: input.code.trim().toUpperCase(),
        name: input.deviceName?.trim() || deviceName,
        platform: Platform.OS,
      });
      await SecureStore.setItemAsync(KEY_URL, url);
      await SecureStore.setItemAsync(KEY_TOKEN, result.token);
      await SecureStore.setItemAsync(KEY_DEVICE, JSON.stringify(result.device));
      setBaseUrl(url);
      setDevice(result.device);
      setFamily(result.family);
      setApiConfig({ baseUrl: url, token: result.token });
      setStatus(result.device.status === 'approved' ? 'ready' : 'pending');
      if (result.device.status === 'approved') await syncNow();
    },
    [deviceName, syncNow],
  );

  const disconnect = useCallback(async () => {
    await signOutLocally();
  }, [signOutLocally]);

  const refresh = useCallback(async () => {
    if (!baseUrl) return;
    try {
      const me = await api.me();
      setDevice(me.device);
      setFamily(me.family);
      if (me.device.status === 'revoked') {
        await signOutLocally();
        return;
      }
      if (me.device.status === 'approved') setStatus('ready');
      if (me.device.status === 'pending') setStatus('pending');
      setSyncError(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await signOutLocally();
      else setSyncError((error as Error).message);
    }
  }, [baseUrl, signOutLocally]);

  const refreshDevices = useCallback(async () => {
    const result = await api.devices();
    return result.devices;
  }, []);

  const approveDevice = useCallback(async (id: string) => {
    await api.approve(id);
  }, []);

  const revokeDevice = useCallback(async (id: string) => {
    await api.revoke(id);
  }, []);

  const createInvite = useCallback(async () => {
    return api.invite(10);
  }, []);

  // Poll while waiting for parental approval.
  useEffect(() => {
    if (status !== 'pending') return;
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [status, refresh]);

  // Periodic sync + sync when returning to the app.
  useEffect(() => {
    if (status !== 'ready') return;
    const timer = setInterval(() => {
      syncNow().catch(() => {});
    }, 60_000);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') syncNow().catch(() => {});
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [status, syncNow]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      baseUrl,
      device,
      family,
      health,
      lastSyncAt,
      outboxCount,
      syncing,
      syncError,
      connect,
      disconnect,
      refresh,
      syncNow,
      refreshDevices,
      approveDevice,
      revokeDevice,
      createInvite,
    }),
    [
      status,
      baseUrl,
      device,
      family,
      health,
      lastSyncAt,
      outboxCount,
      syncing,
      syncError,
      connect,
      disconnect,
      refresh,
      syncNow,
      refreshDevices,
      approveDevice,
      revokeDevice,
      createInvite,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export async function clearEverything(): Promise<void> {
  await wipeLocalData();
}

/** Resolves to `fallback` if the promise rejects or takes longer than `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
