/** Trail catalogue.
 *
 *  Lists the trails with the attributes derived from their geometry and
 *  marks from the listing itself which ones exceed the declared level, so
 *  the warning does not appear only when the download is attempted.
 */
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { listTrails, newId, readProfile, saveTrail, TrailSummary } from '../../src/data/db';
import { InvalidGpxError, parseGpx } from '../../src/data/gpx';
import { Level, LEVEL_ORDER } from '../../src/domain/types';
import { prepareStorage } from '../../src/startup/storage';
import { difficultyColour, LEVEL_LABEL, Palette, sp, useTheme } from '../../src/ui/theme';

export default function Catalog() {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const colour = difficultyColour(c);

  const [trails, setTrails] = useState<TrailSummary[] | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        await prepareStorage();
        const [list, p] = await Promise.all([listTrails(), readProfile()]);
        if (!active) return;
        setTrails(list);
        setLevel(p?.level ?? null);
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  /**
   * Brings a trail in from a GPX file.
   *
   * The attributes are not read from the file. They are computed from
   * the geometry when the trail is stored, for the same reason the
   * server recomputes them: a file can claim whatever it likes about how
   * demanding a route is, and the claim is exactly what the hiker is
   * being protected from.
   *
   * The trail enters as pending review, so an imported route is usable
   * by whoever imported it without appearing in anybody else's
   * catalogue.
   */
  async function importGpx() {
    if (importing) return;
    setImportMessage(null);

    const picked = await DocumentPicker.getDocumentAsync({
      // Several file managers report a GPX as plain XML or as an unknown
      // type, so the list is deliberately wide and the real check is the
      // parse itself.
      type: ['application/gpx+xml', 'application/xml', 'text/xml', '*/*'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets[0]) return;

    setImporting(true);
    try {
      const asset = picked.assets[0];
      const xml = await new File(asset.uri).text();
      const parsed = parseGpx(xml);

      const name =
        parsed.name?.trim() ||
        asset.name?.replace(/\.gpx$/i, '').trim() ||
        'Sendero importado';

      const saved = await saveTrail({
        id: await newId(),
        name,
        ...(parsed.description ? { description: parsed.description } : {}),
        points: parsed.points,
        source: 'imported',
      });

      setTrails(await listTrails());
      setImportMessage(
        `Se importó ${saved.name}: ${(saved.attributes.distanceM / 1000).toFixed(1)} km, ` +
          `${Math.round(saved.attributes.elevationGainM)} m de desnivel, exigencia ` +
          `${LEVEL_LABEL[saved.attributes.difficulty]}.`,
      );
    } catch (error) {
      setImportMessage(
        error instanceof InvalidGpxError
          ? 'El archivo no tiene una traza que podamos leer. Revisá que sea un GPX con puntos de recorrido.'
          : 'No pudimos leer el archivo.',
      );
    } finally {
      setImporting(false);
    }
  }

  if (!trails) {
    return (
      <View style={s.centre}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <Text style={s.title}>Senderos</Text>

      <Pressable style={s.import} onPress={importGpx} disabled={importing}>
        <Text style={s.importText}>
          {importing ? 'Importando…' : 'Importar un sendero desde un archivo GPX'}
        </Text>
      </Pressable>
      {importMessage && <Text style={s.importMessage}>{importMessage}</Text>}

      {trails.map((t) => {
        const exceeds =
          level !== null && LEVEL_ORDER[t.attributes.difficulty] > LEVEL_ORDER[level];
        return (
          <Link key={t.id} href={`/trail/${t.id}`} asChild>
            <Pressable style={s.card}>
              <Text style={s.name}>{t.name}</Text>
              <Text style={s.meta}>
                {(t.attributes.distanceM / 1000).toFixed(1)} km ·{' '}
                {Math.round(t.attributes.elevationGainM)} m de desnivel
              </Text>
              <View style={s.row}>
                <View style={[s.chip, { backgroundColor: colour[t.attributes.difficulty] }]}>
                  <Text style={s.chipText}>{LEVEL_LABEL[t.attributes.difficulty]}</Text>
                </View>
                {exceeds && <Text style={s.exceeds}>Supera tu nivel</Text>}
                {t.downloadedAt !== null && <Text style={s.ready}>Descargado</Text>}
              </View>
            </Pressable>
          </Link>
        );
      })}
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingBottom: sp.xl * 2 },
    title: { fontSize: 32, fontWeight: '800', color: c.text, marginBottom: sp.lg },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    import: {
      borderColor: c.primary,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderRadius: 22,
      paddingVertical: sp.md,
      alignItems: 'center',
      marginBottom: sp.md,
    },
    importText: { color: c.primary, fontWeight: '700', fontSize: 13 },
    importMessage: { color: c.mutedText, fontSize: 12, lineHeight: 17, marginBottom: sp.md },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: sp.md,
      marginBottom: sp.md,
    },
    name: { fontSize: 15, fontWeight: '700', color: c.text },
    meta: { color: c.mutedText, marginTop: 4, fontSize: 13 },
    row: { flexDirection: 'row', alignItems: 'center', marginTop: sp.md, gap: sp.md },
    chip: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
    chipText: { color: '#ffffff', fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
    exceeds: { color: c.danger, fontSize: 12, fontWeight: '600' },
    ready: { color: c.success, fontSize: 12, fontWeight: '600', marginLeft: 'auto' },
  });
