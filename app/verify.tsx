/** Confirming the address a registration was started with.
 *
 *  The last step of signing up, and the first moment the account exists for
 *  anybody. Registration writes the row and sends six digits; nothing is
 *  issued until they come back, so an address belongs to whoever can read
 *  what was sent to it rather than to whoever typed it into a form.
 *
 *  Reached from signing up, and also from signing in, because somebody who
 *  closed the application before entering the code has an account with a
 *  right password and an unproven address. The server answers that sign in
 *  with the address and a fresh code rather than an error, and the device
 *  comes here.
 *
 *  Only the address travels in the route. The name and the declared level
 *  come back in the server's answer, so neither they nor the password are
 *  carried through the navigation state.
 *
 *  See docs/adr/0016.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError, requestPublic } from '../src/data/api';
import { adoptAccount, readProfile, savePreferences } from '../src/data/db';
import { saveTokens } from '../src/data/session';
import { Level } from '../src/domain/types';
import { Button, Field, Notice, ONBOARDING_STEPS, Question, StepBar } from '../src/ui/forms';
import { reportHandover } from '../src/ui/handover';
import { Palette, sp, useTheme } from '../src/ui/theme';

/** How long the code is good for, as the server says when it sends one. */
const DEFAULT_MINUTES = 15;

const LENGTH = 6;

/** What the server answers, mapped to what the person reads. */
const SERVER_ERRORS: Record<string, string> = {
  invalid_code: 'Ese código no es el correcto.',
  expired: 'El código venció. Pedí uno nuevo.',
  exhausted: 'Agotaste los intentos de este código. Pedí uno nuevo.',
  no_code: 'No hay ningún código pendiente. Pedí uno nuevo.',
  already_verified: 'Esa dirección ya está confirmada. Iniciá sesión.',
};

interface Confirmed {
  user: { id: string; name: string; email: string; level: Level };
  accessToken: string;
  refreshToken: string;
}

export default function Verify() {
  const router = useRouter();
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  const params = useLocalSearchParams<{
    email?: string;
    minutes?: string;
    preferences?: string;
  }>();
  const email = (params.email ?? '').trim().toLowerCase();
  const minutes = Number(params.minutes) || DEFAULT_MINUTES;
  // Chosen on the previous screen and carried here, because this is where
  // the profile row that holds them comes into existence.
  const chosen = (params.preferences ?? '').split(',').filter(Boolean);

  const [code, setCode] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  /** Seconds until another code may be asked for. */
  const [wait, setWait] = useState(60);

  /** Whether a profile is already on this device, for the handover notice. */
  const [occupied, setOccupied] = useState(false);

  useEffect(() => {
    readProfile()
      .then((p) => setOccupied(p !== null))
      .catch(() => setOccupied(false));
  }, []);

  // One timer for the whole screen rather than one per render. The countdown
  // is the only thing on it that moves on its own.
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const ready = code.length === LENGTH;

  const confirm = useCallback(async () => {
    if (!ready || working) return;
    setError(null);
    setSent(null);
    setWorking(true);

    try {
      const confirmed = await requestPublic<Confirmed>('/api/auth/register/verify', {
        method: 'POST',
        body: { email, code },
      });

      await saveTokens({
        accessToken: confirmed.accessToken,
        refreshToken: confirmed.refreshToken,
      });
      const { replaced } = await adoptAccount({
        userId: confirmed.user.id,
        name: confirmed.user.name,
        email: confirmed.user.email,
        level: confirmed.user.level,
      });
      if (replaced && !occupied) reportHandover();

      // Written even when nothing was picked, because asked and skipped is
      // a different state from never asked, and only the second is worth
      // asking again. Never a reason to fail a registration that worked.
      await savePreferences(chosen).catch(() => undefined);

      router.replace('/home');
    } catch (caught) {
      const failure = caught as ApiError;
      const named = SERVER_ERRORS[failure.code ?? ''];
      const left = (failure.detail as { attemptsLeft?: number } | undefined)?.attemptsLeft;

      if (failure.code === 'already_verified') {
        setError(named!);
      } else if (named) {
        // The count is worth saying while it is still reassuring. At one
        // remaining it stops being information and starts being a threat.
        setError(left !== undefined && left > 1 ? `${named} Te quedan ${left} intentos.` : named);
      } else {
        setError('No pudimos confirmar el código. Revisá tu conexión y volvé a intentar.');
      }
      setCode('');
    } finally {
      setWorking(false);
    }
  }, [code, email, occupied, ready, router, working]);

  async function resend() {
    if (wait > 0 || working) return;
    setError(null);
    setSent(null);
    setWorking(true);

    try {
      await requestPublic('/api/auth/register/resend', { method: 'POST', body: { email } });
      setSent('Te enviamos un código nuevo.');
      setWait(60);
      setCode('');
    } catch (caught) {
      const failure = caught as ApiError;
      if (failure.code === 'too_soon') {
        setWait((failure.detail as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 60);
      } else {
        setError('No pudimos enviarte otro código. Revisá tu conexión y volvé a intentar.');
      }
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
        <StepBar step={5} of={ONBOARDING_STEPS} />
        <Question
          title="Confirmá tu correo"
          detail={
            <>
              Te enviamos un código de {LENGTH} dígitos a <Text style={s.address}>{email}</Text>.
              Vence en {minutes} minutos.
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
          onSubmitEditing={confirm}
        />

        {!!error && <Notice text={error} tone="danger" />}
        {!!sent && <Notice text={sent} tone="warning" />}

        <Button label="Confirmar" onPress={confirm} busy={working} disabled={!ready} />

        <Pressable onPress={resend} disabled={wait > 0 || working} style={s.resend}>
          <Text style={[s.resendText, wait > 0 && s.resendOff]}>
            {wait > 0 ? `Pedir otro código en ${wait} s` : 'Pedir otro código'}
          </Text>
        </Pressable>

        <Text style={s.footer}>
          Si cerrás la aplicación ahora, podés volver a iniciar sesión con ese correo y tu
          contraseña, y te pedimos el código de nuevo.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingTop: sp.xl, gap: sp.md },
    address: { color: c.text, fontWeight: '700' },
    resend: { alignSelf: 'center', paddingVertical: sp.md, paddingHorizontal: sp.lg },
    resendText: { color: c.primary, fontSize: 14, fontWeight: '700' },
    resendOff: { color: c.mutedText, fontWeight: '600' },
    footer: {
      color: c.mutedText,
      fontSize: 12,
      lineHeight: 17,
      textAlign: 'center',
      marginTop: sp.sm,
    },
  });
