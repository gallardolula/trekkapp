/** Choosing a new password with a code sent to the address.
 *
 *  Two steps on one screen, because the second only makes sense once the
 *  first has happened and sending somebody between two screens to type one
 *  address and then six digits reads as further than it is.
 *
 *  A code and not a link. A link has to reopen the application through its
 *  own scheme, which a development client does not register, so a link
 *  could not be exercised on the device this prototype is tested on. The
 *  code is also less to do on a phone, where the message and the field are
 *  both on the same screen.
 *
 *  Succeeding here issues a session. The person has just proved they hold
 *  the address and just chosen the password, which is more than signing in
 *  asks of them. Every other session of the account is closed by the
 *  server at the same moment. See docs/adr/0017.
 */
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { ApiError, requestPublic } from '../src/data/api';
import { adoptAccount } from '../src/data/db';
import { saveTokens } from '../src/data/session';
import { Level } from '../src/domain/types';
import { Button, Field, Notice, Question } from '../src/ui/forms';
import { Palette, sp, useTheme } from '../src/ui/theme';

const LENGTH = 6;

const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

/** The same rules the server enforces, checked here to spare a round trip. */
const PASSWORD_RULES: { test: (v: string) => boolean; label: string }[] = [
  { test: (v) => v.length >= 8, label: 'ocho caracteres' },
  { test: (v) => /[A-Z]/.test(v), label: 'una mayúscula' },
  { test: (v) => /[a-z]/.test(v), label: 'una minúscula' },
  { test: (v) => /[0-9]/.test(v), label: 'un número' },
  { test: (v) => /[^A-Za-z0-9]/.test(v), label: 'un símbolo' },
];

const SERVER_ERRORS: Record<string, string> = {
  invalid_code: 'Ese código no es el correcto.',
  expired: 'El código venció. Pedí uno nuevo.',
  exhausted: 'Agotaste los intentos de este código. Pedí uno nuevo.',
  no_code: 'No hay ningún código pendiente. Pedí uno nuevo.',
  too_soon: 'Esperá un momento antes de pedir otro código.',
};

interface Recovered {
  user: { id: string; name: string; email: string; level: Level };
  accessToken: string;
  refreshToken: string;
}

export default function Recover() {
  const router = useRouter();
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  const [asked, setAsked] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = PASSWORD_RULES.filter((r) => !r.test(password));
  const ready = code.length === LENGTH && missing.length === 0;

  function explain(caught: unknown, fallback: string) {
    const failure = caught as ApiError;
    const named = failure instanceof ApiError ? SERVER_ERRORS[failure.code] : undefined;
    const left = (failure as ApiError)?.detail as { attemptsLeft?: number } | undefined;
    if (!named) return setError(fallback);
    setError(
      left?.attemptsLeft !== undefined && left.attemptsLeft > 1
        ? `${named} Te quedan ${left.attemptsLeft} intentos.`
        : named,
    );
  }

  async function ask() {
    if (!validEmail(email) || working) return;
    setError(null);
    setWorking(true);
    try {
      await requestPublic('/api/auth/password/forgot', {
        method: 'POST',
        body: { email: email.trim().toLowerCase() },
      });
      setAsked(true);
    } catch (caught) {
      explain(caught, 'No pudimos enviarte el código. Revisá tu conexión y volvé a intentar.');
    } finally {
      setWorking(false);
    }
  }

  async function change() {
    if (!ready || working) return;
    setError(null);
    setWorking(true);
    try {
      const recovered = await requestPublic<Recovered>('/api/auth/password/reset', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), code, password },
      });

      await saveTokens({
        accessToken: recovered.accessToken,
        refreshToken: recovered.refreshToken,
      });
      await adoptAccount({
        userId: recovered.user.id,
        name: recovered.user.name,
        email: recovered.user.email,
        level: recovered.user.level,
      });

      router.replace('/home');
    } catch (caught) {
      explain(caught, 'No pudimos cambiar la contraseña. Revisá tu conexión y volvé a intentar.');
      setCode('');
    } finally {
      setWorking(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {!asked ? (
          <>
            <Question title="Cambiar la contraseña" detail="Te enviamos un código a tu correo." />
            <Field
              label="Correo"
              value={email}
              onChangeText={setEmail}
              placeholder="tu@correo.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              autoFocus
              onSubmitEditing={ask}
            />
            {!!error && <Notice text={error} tone="danger" />}
            <Button
              label="Enviarme un código"
              onPress={ask}
              busy={working}
              disabled={!validEmail(email)}
            />
          </>
        ) : (
          <>
            <Question
              title="Elegí una contraseña nueva"
              detail={
                <>
                  Escribí el código de {LENGTH} dígitos que enviamos a{' '}
                  <Text style={s.address}>{email.trim().toLowerCase()}</Text>.
                </>
              }
            />
            <Field
              label="Código"
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, LENGTH))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={LENGTH}
              autoFocus
            />
            <Field
              label="Contraseña nueva"
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoComplete="new-password"
              secret
              onSubmitEditing={change}
            />
            {missing.length > 0 && password.length > 0 && (
              <Text style={s.rules}>Falta {missing.map((r) => r.label).join(', ')}.</Text>
            )}
            {!!error && <Notice text={error} tone="danger" />}
            <Button
              label="Cambiar la contraseña"
              onPress={change}
              busy={working}
              disabled={!ready}
            />
          </>
        )}

        <Pressable onPress={() => router.back()} style={s.back}>
          <Text style={s.backText}>Volver</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingTop: sp.xl, gap: sp.md },
    address: { color: c.text, fontWeight: '700' },
    rules: { color: c.mutedText, fontSize: 12.5, lineHeight: 18 },
    back: { alignSelf: 'center', paddingVertical: sp.md, paddingHorizontal: sp.lg },
    backText: { color: c.mutedText, fontSize: 13, fontWeight: '600' },
  });
