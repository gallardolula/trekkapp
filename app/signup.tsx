/** Hiker sign up.
 *
 *  In the final design the account lives on the server, so it can be
 *  recovered from another device with email and password. Server side
 *  registration and login belong to the same component as synchronisation,
 *  still pending, so here the local profile the rest of the application needs
 *  is created.
 */
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { saveProfile } from '../src/data/db';
import { Level } from '../src/domain/types';
import { difficultyColour, LEVEL_LABEL, Palette, sp, useTheme } from '../src/ui/theme';

const LEVELS: { level: Level; detail: string }[] = [
  { level: 'beginner', detail: 'Salidas de medio día por senderos señalizados.' },
  { level: 'intermediate', detail: 'Jornadas completas con desnivel sostenido.' },
  { level: 'advanced', detail: 'Varias jornadas, terreno expuesto, orientación autónoma.' },
];

const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

export default function SignUp() {
  const router = useRouter();
  const { c, refresh } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState<Level | null>(null);
  const [attempted, setAttempted] = useState(false);

  const nameError = name.trim().length < 2 ? 'Ingresá tu nombre.' : null;
  const emailError = !validEmail(email) ? 'Ingresá un correo válido.' : null;
  const levelError = level === null ? 'Elegí tu nivel de experiencia.' : null;
  const valid = !nameError && !emailError && !levelError;

  async function createAccount() {
    setAttempted(true);
    if (!valid || !level) return;
    await saveProfile({ name: name.trim(), email: email.trim().toLowerCase(), level });
    refresh();
    router.replace('/');
  }

  const levelColour = difficultyColour(c);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>Creá tu cuenta</Text>
        <Text style={s.intro}>
          Tu nivel de experiencia determina cuándo la aplicación te advierte antes de descargar un
          sendero.
        </Text>

        <Text style={s.label}>Nombre</Text>
        <TextInput
          style={s.field}
          value={name}
          onChangeText={setName}
          placeholder="Cómo querés que te llamemos"
          placeholderTextColor={c.mutedText}
          autoCapitalize="words"
        />
        {attempted && nameError && <Text style={s.error}>{nameError}</Text>}

        <Text style={s.label}>Correo electrónico</Text>
        <TextInput
          style={s.field}
          value={email}
          onChangeText={setEmail}
          placeholder="nombre@correo.com"
          placeholderTextColor={c.mutedText}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        {attempted && emailError && <Text style={s.error}>{emailError}</Text>}

        <Text style={s.label}>Nivel de experiencia</Text>
        {LEVELS.map((o) => {
          const chosen = level === o.level;
          return (
            <Pressable
              key={o.level}
              onPress={() => setLevel(o.level)}
              style={[s.option, chosen && { borderColor: levelColour[o.level], borderWidth: 2 }]}
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

        <Pressable style={[s.button, !valid && s.buttonOff]} onPress={createAccount}>
          <Text style={s.buttonText}>Crear cuenta</Text>
        </Pressable>

        <Text style={s.note}>
          La cuenta se registra en el servidor al sincronizar, de modo que puedas recuperarla desde
          otro dispositivo. Hasta entonces el perfil queda en este teléfono y el recorrido funciona
          sin conexión.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingBottom: sp.xl * 2 },
    title: { fontSize: 22, fontWeight: '700', color: c.text },
    intro: { color: c.mutedText, fontSize: 13, lineHeight: 19, marginTop: sp.sm, marginBottom: sp.lg },
    label: { color: c.text, fontWeight: '700', fontSize: 13, marginBottom: sp.sm, marginTop: sp.md },
    field: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: sp.md,
      paddingVertical: 12,
      color: c.text,
      fontSize: 15,
    },
    error: { color: c.danger, fontSize: 12, marginTop: sp.xs },
    option: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: sp.md,
      marginBottom: sp.sm,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: sp.sm },
    dot: { width: 10, height: 10, borderRadius: 5 },
    optionTitle: { fontWeight: '700', color: c.text, fontSize: 14, textTransform: 'capitalize' },
    optionDetail: { color: c.mutedText, fontSize: 12, marginTop: sp.xs, lineHeight: 17 },
    button: {
      backgroundColor: c.primary,
      borderRadius: 10,
      paddingVertical: 15,
      alignItems: 'center',
      marginTop: sp.lg,
    },
    buttonOff: { opacity: 0.5 },
    buttonText: { color: c.onPrimary, fontWeight: '700', fontSize: 15 },
    note: { color: c.mutedText, fontSize: 11, lineHeight: 16, marginTop: sp.lg, textAlign: 'center' },
  });
