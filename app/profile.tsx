/** Hiker profile and appearance.
 *
 *  Holds the account data, the declared level and the light or dark mode
 *  preference, which is stored with the profile because it is a decision
 *  about power draw and night vision rather than a matter of taste.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import {
  countPendingSync,
  listTrails,
  Profile as ProfileData,
  readProfile,
  saveLevel,
  TrailSummary,
} from '../src/data/db';
import { Level } from '../src/domain/types';
import { prepareStorage } from '../src/startup/storage';
import { difficultyColour, LEVEL_LABEL, Palette, sp, useTheme } from '../src/ui/theme';

const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];

export default function Profile() {
  const { c, mode, toggle } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const colour = difficultyColour(c);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [pending, setPending] = useState(0);
  const [offlineReady, setOfflineReady] = useState<TrailSummary[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        await prepareStorage();
        const [p, n, list] = await Promise.all([
          readProfile(),
          countPendingSync(),
          listTrails(),
        ]);
        if (!active) return;
        setProfile(p);
        setPending(n);
        setOfflineReady(list.filter((t) => t.downloadedAt !== null));
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  async function changeLevel(level: Level) {
    await saveLevel(level);
    setProfile((p) => (p ? { ...p, level } : p));
  }

  if (!profile) {
    return (
      <View style={s.centre}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.identity}>
        <Text style={s.name}>{profile.name}</Text>
        <Text style={s.email}>{profile.email}</Text>
      </View>

      <Text style={s.section}>Nivel de experiencia</Text>
      <View style={s.levels}>
        {LEVELS.map((l) => {
          const chosen = profile.level === l;
          return (
            <Pressable
              key={l}
              onPress={() => changeLevel(l)}
              style={[s.levelChip, chosen && { backgroundColor: colour[l], borderColor: colour[l] }]}
            >
              <Text style={[s.levelText, chosen && { color: '#ffffff' }]}>{LEVEL_LABEL[l]}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={s.hint}>
        Determina cuándo la aplicación pide una confirmación antes de descargar un sendero.
      </Text>

      <Text style={s.section}>Apariencia</Text>
      <View style={s.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.switchTitle}>Modo oscuro</Text>
          <Text style={s.switchDetail}>
            Reduce el consumo en pantallas OLED y preserva la visión nocturna durante un recorrido
            en penumbra.
          </Text>
        </View>
        <Switch value={mode === 'dark'} onValueChange={toggle} />
      </View>

      <Text style={s.section}>Senderos descargados</Text>
      <View style={s.card}>
        <Text style={s.cardText}>
          {offlineReady.length === 0
            ? 'Todavía no descargaste ningún sendero.'
            : `${offlineReady.length} sendero${offlineReady.length === 1 ? '' : 's'} disponible${
                offlineReady.length === 1 ? '' : 's'
              } para recorrer sin conexión.`}
        </Text>
        {offlineReady.map((t) => (
          <Text key={t.id} style={s.listItem}>
            {t.name}
          </Text>
        ))}
      </View>

      <Text style={s.section}>Sincronización</Text>
      <View style={s.card}>
        <Text style={s.cardText}>
          {pending === 0
            ? 'No hay reportes pendientes de enviar.'
            : `${pending} reporte${pending === 1 ? '' : 's'} esperando conexión.`}
        </Text>
        <Text style={s.cardNote}>
          La sincronización con el servidor es un componente pendiente de implementación.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingBottom: sp.xl * 2 },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    identity: { marginBottom: sp.lg },
    name: { fontSize: 22, fontWeight: '800', color: c.text },
    email: { color: c.mutedText, fontSize: 13, marginTop: 2 },
    section: { color: c.text, fontWeight: '700', fontSize: 13, marginTop: sp.lg, marginBottom: sp.sm },
    levels: { flexDirection: 'row', gap: sp.sm },
    levelChip: {
      flex: 1,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 20,
      paddingVertical: 8,
      alignItems: 'center',
    },
    levelText: { color: c.text, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
    hint: { color: c.mutedText, fontSize: 11, marginTop: sp.sm, lineHeight: 16 },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp.md,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: sp.md,
    },
    switchTitle: { color: c.text, fontWeight: '700', fontSize: 14 },
    switchDetail: { color: c.mutedText, fontSize: 12, marginTop: 2, lineHeight: 17 },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: sp.md,
    },
    cardText: { color: c.text, fontSize: 13 },
    listItem: { color: c.mutedText, fontSize: 12, marginTop: sp.sm, lineHeight: 17 },
    cardNote: { color: c.mutedText, fontSize: 11, marginTop: sp.sm, lineHeight: 16 },
  });
