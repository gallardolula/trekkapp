/** Leaving a report about the state of a path.
 *
 *  Two questions and nothing else: what you found, and where. Asked in that
 *  order because the kind is what somebody already knows when they reach for
 *  the phone, and the place is the part they may want to adjust.
 *
 *  The place matters more than it looks. A report with no position is a note
 *  about a trail; a report anchored to a point is a note about a ford, and
 *  only the second one can warn the next person at the right moment or be
 *  counted against the stretch it concerns.
 */
import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { REPORT_KINDS, type ReportKind } from '../domain/reports';
import { Button } from './forms';
import { Palette, sp, useTheme } from './theme';

/** Where the report is being put. */
export type ReportPlace =
  | { kind: 'here' }
  | { kind: 'onTrack'; alongM: number; offTrackM: number };

export interface ReportDraft {
  kindId: string;
  comment: string;
}

export interface ReportSheetProps {
  open: boolean;
  /** Null while there is no position fix, which disables reporting here. */
  hasPosition: boolean;
  /** Set once a point has been marked on the map. */
  place: ReportPlace;
  onClose: () => void;
  /** Leaves the sheet so the hiker can tap the map. */
  onPickOnMap: () => void;
  onUseCurrentPosition: () => void;
  onSave: (draft: ReportDraft) => Promise<void>;
}

export function ReportSheet({
  open,
  hasPosition,
  place,
  onClose,
  onPickOnMap,
  onUseCurrentPosition,
  onSave,
}: ReportSheetProps) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  const [chosen, setChosen] = useState<ReportKind | null>(null);
  const [comment, setComment] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);

  const needsComment = chosen?.requiresComment === true;
  const commentMissing = needsComment && comment.trim().length < 3;
  const placeMissing = place.kind === 'here' && !hasPosition;
  const ready = chosen !== null && !commentMissing && !placeMissing;

  function reset() {
    setChosen(null);
    setComment('');
    setAttempted(false);
  }

  async function save() {
    setAttempted(true);
    if (!ready || saving) return;
    setSaving(true);
    try {
      await onSave({ kindId: chosen!.id, comment: comment.trim() });
      reset();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.grip} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={s.title}>¿Qué encontraste?</Text>

            <View style={s.grid}>
              {REPORT_KINDS.map((k) => {
                const on = chosen?.id === k.id;
                return (
                  <Pressable
                    key={k.id}
                    onPress={() => setChosen(k)}
                    style={[s.kind, on && { borderColor: c.primary, borderWidth: 2 }]}
                  >
                    <Text style={[s.kindLabel, on && { color: c.primary }]}>{k.label}</Text>
                    <Text style={s.kindDetail}>{k.detail}</Text>
                  </Pressable>
                );
              })}
            </View>
            {attempted && chosen === null && (
              <Text style={s.error}>Elegí qué encontraste.</Text>
            )}

            {chosen && (
              <>
                <Text style={s.label}>
                  {needsComment ? 'Contanos qué pasó' : 'Algo para agregar (opcional)'}
                </Text>
                <TextInput
                  style={s.input}
                  value={comment}
                  onChangeText={setComment}
                  placeholder={
                    needsComment
                      ? 'Por ejemplo, un puente de madera con tablones flojos'
                      : 'Cualquier detalle que le sirva a quien venga después'
                  }
                  placeholderTextColor={c.mutedText}
                  multiline
                  maxLength={500}
                />
                {attempted && commentMissing && (
                  <Text style={s.error}>
                    Un aviso que el sistema no entiende sólo sirve si lo explicás con palabras.
                  </Text>
                )}
              </>
            )}

            <Text style={s.label}>¿Dónde?</Text>
            <View style={s.places}>
              <Pressable
                onPress={onUseCurrentPosition}
                disabled={!hasPosition}
                style={[
                  s.place,
                  place.kind === 'here' && hasPosition && { borderColor: c.primary, borderWidth: 2 },
                  !hasPosition && s.placeOff,
                ]}
              >
                <Text style={s.placeLabel}>Donde estoy</Text>
                <Text style={s.placeDetail}>
                  {hasPosition ? 'Usa la lectura del receptor' : 'Todavía no hay lectura'}
                </Text>
              </Pressable>

              <Pressable
                onPress={onPickOnMap}
                style={[
                  s.place,
                  place.kind === 'onTrack' && { borderColor: c.primary, borderWidth: 2 },
                ]}
              >
                <Text style={s.placeLabel}>Marcar en el mapa</Text>
                <Text style={s.placeDetail}>
                  {place.kind === 'onTrack'
                    ? `En el km ${(place.alongM / 1000).toFixed(2)} del sendero`
                    : 'Tocá el punto exacto del sendero'}
                </Text>
              </Pressable>
            </View>

            {place.kind === 'onTrack' && place.offTrackM > 25 && (
              <Text style={s.hint}>
                Marcaste a {Math.round(place.offTrackM)} m de la traza y el aviso se guarda sobre
                el sendero, en el punto más cercano. Así dos personas que reportan el mismo vado
                desde orillas distintas dejan el aviso en el mismo lugar.
              </Text>
            )}
            {placeMissing && (
              <Text style={s.error}>
                Sin lectura del receptor, marcá el punto en el mapa.
              </Text>
            )}

            <View style={s.actions}>
              <Button label="Guardar el aviso" onPress={save} busy={saving} disabled={!ready} />
              <Button
                label="Cancelar"
                variant="quiet"
                onPress={() => {
                  reset();
                  onClose();
                }}
              />
            </View>

            <Text style={s.footer}>
              Se guarda en el teléfono y viaja al servidor la próxima vez que sincronices.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: c.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: sp.lg,
      paddingBottom: sp.xl,
      maxHeight: '88%',
    },
    grip: {
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: c.border,
      alignSelf: 'center',
      marginVertical: sp.md,
    },
    title: { color: c.text, fontSize: 22, fontWeight: '800', marginBottom: sp.lg },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm },
    kind: {
      width: '48.5%',
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1.5,
      borderRadius: 14,
      padding: sp.md,
      minHeight: 92,
    },
    kindLabel: { color: c.text, fontWeight: '700', fontSize: 14 },
    kindDetail: { color: c.mutedText, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
    label: {
      color: c.text,
      fontWeight: '700',
      fontSize: 13,
      marginTop: sp.lg,
      marginBottom: sp.sm,
    },
    input: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1.5,
      borderRadius: 14,
      padding: sp.md,
      color: c.text,
      fontSize: 15,
      minHeight: 84,
      textAlignVertical: 'top',
    },
    places: { flexDirection: 'row', gap: sp.sm },
    place: {
      flex: 1,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1.5,
      borderRadius: 14,
      padding: sp.md,
    },
    placeOff: { opacity: 0.5 },
    placeLabel: { color: c.text, fontWeight: '700', fontSize: 13.5 },
    placeDetail: { color: c.mutedText, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
    hint: { color: c.mutedText, fontSize: 11.5, lineHeight: 17, marginTop: sp.sm },
    error: { color: c.danger, fontSize: 12.5, marginTop: sp.sm },
    actions: { gap: sp.xs, marginTop: sp.lg },
    footer: {
      color: c.mutedText,
      fontSize: 11,
      textAlign: 'center',
      marginTop: sp.sm,
      lineHeight: 16,
    },
  });
