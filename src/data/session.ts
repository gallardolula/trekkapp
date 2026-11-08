/** The hiker's session with the server.
 *
 *  Tokens live in the operating system's secure store, the keychain on iOS
 *  and the key store on Android, and never in the application's ordinary
 *  storage next to the database. The password is never kept at all, so
 *  losing the device does not hand over the credential that would let
 *  somebody sign in somewhere else.
 */
import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'trekkapp.accessToken';
const REFRESH_KEY = 'trekkapp.refreshToken';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Reading the secure store can fail on a device without a lock screen, and
 * that is not a reason to crash on start-up. It means there is no session.
 */
async function read(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function readTokens(): Promise<Tokens | null> {
  const [accessToken, refreshToken] = await Promise.all([read(ACCESS_KEY), read(REFRESH_KEY)]);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export async function saveTokens(tokens: Tokens): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY).catch(() => undefined),
    SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined),
  ]);
}
