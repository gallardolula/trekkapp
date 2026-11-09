/** Hiker sign up.
 *
 *  The account lives on the server, which is what lets it be recovered from
 *  another device with an address and a password. This screen and signing in
 *  are the only two that need coverage; everything the walk itself needs
 *  runs on the device afterwards.
 *
 *  Asked one question at a time, which is what every application of this
 *  kind does and for a good reason. A single form with four fields and five
 *  password rules reads as an obstacle; four short questions with a bar
 *  showing the end read as a conversation. Nothing is sent until the last
 *  one, so the whole thing is still a single request.
 *
 *  It does not finish the registration. The server answers with nothing
 *  usable and sends a code to the address, and the screen that asks for it
 *  is where the session begins. See docs/adr/0016.
 *
 *  The declared level is asked here rather than later because it decides
 *  when the application warns somebody before downloading a trail beyond
 *  what they said they walk.
 */
import { Link, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { requestPublic } from '../src/data/api';
import { readProfile } from '../src/data/db';
import { Level } from '../src/domain/types';
import { Button, Field, Notice, ONBOARDING_STEPS, Question, StepBar } from '../src/ui/forms';
import { confirmHandover } from '../src/ui/handover';
import { difficultyColour, LEVEL_LABEL, Palette, sp, useTheme } from '../src/ui/theme';

const LEVELS: { level: Level; detail: string }[] = [
  { level: 'beginner', detail: 'Salidas de medio día por senderos señalizados.' },
  { level: 'intermediate', detail: 'Jornadas completas con desnivel sostenido.' },
  { level: 'advanced', detail: 'Varias jornadas, terreno expuesto, orientación autónoma.' },
];

const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

// The same rules the server enforces. Checking them here too is not
// duplication for its own sake: it spares a round trip and, more to the
// point, tells the person what is wrong while they are still typing.
const PASSWORD_RULES: { test: (v: string) => boolean; label: string }[] = [
  { test: (v) => v.length >= 8, label: 'ocho caracteres' },
  { test: (v) => /[A-Z]/.test(v), label: 'una mayúscula' },
  { test: (v) => /[a-z]/.test(v), label: 'una minúscula' },
  { test: (v) => /[0-9]/.test(v), label: 'un número' },
  { test: (v) => /[^A-Za-z0-9]/.test(v), label: 'un símbolo' },
];

// What the server answers, mapped to what the person reads. The server
// speaks in codes precisely so the wording belongs to the application.
const SERVER_ERRORS: Record<string, string> = {
  email_taken: 'Ya existe una cuenta con ese correo. Probá iniciar sesión.',
  weak_password: 'La contraseña no cumple los requisitos.',
  invalid_body: 'Revisá los datos ingresados.',
};

/** The questions this screen asks. The bar counts every screen. */
const QUESTIONS = 4;

export default function SignUp() {
  const router = useRouter();
  const { c, refresh } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  const [step, setStep] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [level, setLevel] = useState<Level | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [working, setWorking] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // A new account on a phone that already holds one means the previous
  // hiker's data is about to go, which they have to be told before it does.
  const [occupied, setOccupied] = useState(false);
  useEffect(() => {
    let active = true;
    readProfile().then((p) => {
      if (active) setOccupied(p !== null);
    });
    return () => {
      active = false;
    };
  }, []);

  const missing = PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.label);
  const emailError = !validEmail(email) ? 'Ingresá un correo válido.' : null;
  const passwordError = missing.length > 0 ? `Falta ${missing.join(', ')}.` : null;
  const nameError = name.trim().length < 2 ? 'Ingresá tu nombre.' : null;

  const levelError = level === null ? 'Elegí el tipo de salidas que hacés.' : null;
  const stepError = [emailError, passwordError, nameError, levelError][step];
  const canAdvance = !stepError;

  function next() {
    setAttempted(true);
    if (!canAdvance) return;
    setAttempted(false);
    if (step < QUESTIONS - 1) setStep((n) => n + 1);
    else void createAccount();
  }

  function back() {
    setServerError(null);
    setAttempted(false);
    if (step === 0) router.back();
    else setStep((n) => n - 1);
  }

  /**
   * Creates the account against the server and then stores it locally.
   *
   * This is the one moment that needs coverage. It does not constrain the
   * intended use, because the trail and its cartography have to be
   * downloaded before leaving anyway, and it is what lets the account be
   * recovered later from another device.
   */
  async function createAccount() {
    setServerError(null);
    if (!level || working) return;
    if (occupied && !(await confirmHandover())) return;

    setWorking(true);
    try {
      const address = email.trim().toLowerCase();
      const started = await requestPublic<{ email: string; expiresInMinutes: number }>(
        '/api/auth/register',
        {
          method: 'POST',
          body: { name: name.trim(), email: address, password, level },
        },
      );

      // Nothing is stored here any more. The account exists on the server
      // but holds no session, and the next screen is where the code turns
      // it into one.
      router.replace({
        pathname: '/verify',
        params: { email: started.email, minutes: String(started.expiresInMinutes) },
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      // Whatever went wrong belongs to a step, so the person is taken back
      // to the one that can fix it instead of reading an error about a
      // field they can no longer see.
      if (code === 'email_taken') setStep(0);
      if (code === 'weak_password') setStep(1);
      setServerError(
        code && SERVER_ERRORS[code]
          ? SERVER_ERRORS[code]
          : 'No pudimos crear la cuenta. Revisá tu conexión y volvé a intentar.',
      );
    } finally {
      setWorking(false);
    }
  }

  const levelColour = difficultyColour(c);
  const last = step === QUESTIONS - 1;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <StepBar step={step} of={ONBOARDING_STEPS} />

        {step === 0 && (
          <>
            <Question
              title="Empecemos por tu correo"
              detail="Con él vas a poder recuperar la cuenta desde otro teléfono."
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
              onSubmitEditing={next}
              returnKeyType="next"
            />
          </>
        )}

        {step === 1 && (
          <>
            <Question title="Elegí una contraseña" />
            <Field
              label="Contraseña"
              value={password}
              onChangeText={setPassword}
              error={attempted ? passwordError : null}
              placeholder="Al menos ocho caracteres"
              autoCapitalize="none"
              autoComplete="new-password"
              secret
              autoFocus
              onSubmitEditing={next}
              returnKeyType="next"
            />
            <View style={s.rules}>
              {PASSWORD_RULES.map((r) => {
                const met = r.test(password);
                return (
                  <Text key={r.label} style={[s.rule, met && { color: c.success }]}>
                    {met ? '✓' : '·'} {r.label}
                  </Text>
                );
              })}
            </View>
          </>
        )}

        {step === 2 && (
          <>
            <Question title="¿Cómo te llamamos?" detail="Es el nombre que vas a ver al entrar." />
            <Field
              label="Nombre"
              value={name}
              onChangeText={setName}
              error={attempted ? nameError : null}
              placeholder="Tu nombre"
              autoCapitalize="words"
              autoFocus
              clearable
              onSubmitEditing={next}
              returnKeyType="next"
            />
          </>
        )}

        {step === 3 && (
          <>
            <Question
              title="¿Qué tipo de salidas hacés?"
              detail="Determina cuándo la aplicación te advierte antes de descargar un sendero más exigente de lo que caminás."
            />
            {LEVELS.map((o) => {
              const chosen = level === o.level;
              return (
                <Pressable
                  key={o.level}
                  onPress={() => setLevel(o.level)}
                  style={[
                    s.option,
                    chosen && { borderColor: levelColour[o.level], borderWidth: 2 },
                  ]}
                >
                  <View style={s.row}>
                    <View style={[s.dot, { backgroundColor: levelColour[o.level] }]} />
                    <Text style={s.optionTitle}>{LEVEL_LABEL[o.level]}</Text>
                  </View>
                  <Text style={s.optionDetail}>{o.detail}</Text>
                </Pressable>
              );
            })}
            {attempted && levelError && <Text style={s.error}>{levelError}</Text>}
          </>
        )}

        {serverError && <Notice text={serverError} tone="danger" />}

        <View style={s.actions}>
          <Button
            label={last ? 'Crear cuenta' : 'Continuar'}
            onPress={next}
            busy={working}
            disabled={!canAdvance}
          />
          <Button label="Volver" variant="quiet" onPress={back} />
        </View>

        <View style={s.alternative}>
          <Text style={s.alternativeText}>¿Ya tenés cuenta?</Text>
          <Link href="/signin" replace style={s.link}>
            Iniciá sesión
          </Link>
        </View>

        {last && (
          <Text style={s.note}>
            La cuenta se registra en el servidor, así que este paso necesita conexión por única
            vez. Eso es lo que te permite recuperarla desde otro dispositivo.
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingTop: sp.lg, paddingBottom: sp.xl * 2 },
    rules: { gap: 2, marginTop: sp.xs, marginLeft: sp.xs },
    rule: { color: c.mutedText, fontSize: 12.5, lineHeight: 18 },
    error: { color: c.danger, fontSize: 12.5, marginTop: sp.xs },
    option: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1.5,
      borderRadius: 14,
      padding: sp.lg,
      marginBottom: sp.sm,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: sp.sm },
    dot: { width: 10, height: 10, borderRadius: 5 },
    optionTitle: { fontWeight: '700', color: c.text, fontSize: 15, textTransform: 'capitalize' },
    optionDetail: { color: c.mutedText, fontSize: 13, marginTop: sp.xs, lineHeight: 19 },
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
