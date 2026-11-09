/** Signing in to an existing account.
 *
 *  The account lives on the server, which is what lets it be recovered on a
 *  different phone, so this is one of the two screens in the application
 *  that needs coverage. Everything after it runs on the device.
 *
 *  One screen and not a sequence of steps, unlike signing up. Somebody here
 *  already knows both answers and is trying to get past this screen, not to
 *  be guided through it; the password managers of both platforms also fill
 *  the pair in one go.
 */
import { Link, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError, requestPublic } from '../src/data/api';
import { adoptAccount, readProfile } from '../src/data/db';
import { saveTokens } from '../src/data/session';
import { Level } from '../src/domain/types';
import { Button, Field, Notice, Question } from '../src/ui/forms';
import { confirmHandover, HANDOVER_WARNING, reportHandover } from '../src/ui/handover';
import { Palette, sp, useTheme } from '../src/ui/theme';

const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

interface Session {
  user: { id: string; name: string; email: string; level: Level };
  accessToken: string;
  refreshToken: string;
}

/**
 * Turns the server's answer into something worth reading.
 *
 * The password is never said to be the wrong half of the pair, because
 * telling somebody that an address exists is telling anybody who asks.
 */
function explain(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'No pudimos conectarnos. Revisá tu conexión y volvé a intentar.';
  }
  if (error.status === 401) {
    return 'El correo o la contraseña no coinciden.';
  }
  if (error.status === 423) {
    // The server locks an account after several failed attempts, and saying
    // for how long is the difference between a wait and a dead end.
    const until = (error.detail as { until?: string } | undefined)?.until;
    const minutes = until
      ? Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60000))
      : null;
    return minutes
      ? `Por seguridad la cuenta quedó bloqueada tras varios intentos fallidos. Volvé a probar en ${minutes} minuto${minutes === 1 ? '' : 's'}.`
      : 'Por seguridad la cuenta quedó bloqueada tras varios intentos fallidos. Volvé a probar en unos minutos.';
  }
  return 'No pudimos iniciar tu sesión. Volvé a intentar en un momento.';
}

export default function SignIn() {
  const router = useRouter();
  const { c, refresh } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [working, setWorking] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Whose data the device is holding, so the warning can be shown before a
  // password is typed rather than after everything is already gone.
  const [heldEmail, setHeldEmail] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    readProfile().then((p) => {
      if (active) setHeldEmail(p?.email ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const emailError = !validEmail(email) ? 'Ingresá un correo válido.' : null;
  const passwordError = password.length === 0 ? 'Ingresá tu contraseña.' : null;
  const valid = !emailError && !passwordError;

  const handover =
    heldEmail !== null &&
    validEmail(email) &&
    email.trim().toLowerCase() !== heldEmail.toLowerCase();

  async function signIn() {
    setAttempted(true);
    setServerError(null);
    if (!valid || working) return;
    if (handover && !(await confirmHandover())) return;

    setWorking(true);
    try {
      const session = await requestPublic<Session>('/api/auth/session', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), password },
      });

      // The tokens go in first. If adopting the account were interrupted
      // afterwards the hiker would still have a usable session, whereas the
      // other order would leave a profile with nothing to authenticate it.
      await saveTokens({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      });
      const { replaced } = await adoptAccount({
        userId: session.user.id,
        name: session.user.name,
        email: session.user.email,
        level: session.user.level,
      });

      // The warning is driven by the stored address, and the decision by the
      // account identifier, which is the authoritative one. They disagree
      // when the device held a profile with no address, so the hiker is told
      // afterwards rather than not at all.
      if (replaced && !handover) reportHandover();

      refresh();
      router.replace('/home');
    } catch (error) {
      setServerError(explain(error));
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
        <Question
          title="Bienvenida de vuelta"
          detail="Entrá con la cuenta que ya tenés y la aplicación recupera tu nivel y tus recorridos."
        />

        <Field
          label="Correo electrónico"
          value={email}
          onChangeText={setEmail}
          error={attempted ? emailError : null}
          placeholder="nombre@correo.com"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          autoFocus
          clearable
        />

        <Field
          label="Contraseña"
          value={password}
          onChangeText={setPassword}
          error={attempted ? passwordError : null}
          placeholder="Tu contraseña"
          autoCapitalize="none"
          autoComplete="current-password"
          secret
          onSubmitEditing={signIn}
          returnKeyType="go"
        />

        {handover && <Notice text={HANDOVER_WARNING} tone="warning" />}
        {serverError && <Notice text={serverError} tone="danger" />}

        <View style={s.actions}>
          <Button label="Entrar" onPress={signIn} busy={working} disabled={!valid} />
          <Button label="Volver" variant="quiet" onPress={() => router.back()} />
        </View>

        <View style={s.alternative}>
          <Text style={s.alternativeText}>¿Todavía no tenés cuenta?</Text>
          <Link href="/signup" replace style={s.link}>
            Creá una
          </Link>
        </View>

        <Text style={s.note}>
          Este paso necesita conexión por única vez. Después el recorrido completo funciona sin
          señal.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingTop: sp.xl, paddingBottom: sp.xl * 2 },
    actions: { gap: sp.xs, marginTop: sp.lg },
    alternative: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: sp.xs,
      marginTop: sp.md,
    },
    alternativeText: { color: c.mutedText, fontSize: 13 },
    link: { color: c.primary, fontSize: 13, fontWeight: '700' },
    note: {
      color: c.mutedText,
      fontSize: 11.5,
      lineHeight: 16,
      marginTop: sp.lg,
      textAlign: 'center',
    },
  });
