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
 *
 *  What you found is asked as a drawing and a word rather than a paragraph.
 *  This is answered on a path, in the rain, by somebody who already knows
 *  what they are looking at, and a wall of sentences is read slowest by
 *  exactly the person in the biggest hurry. The kinds are grouped by what
 *  they mean for walking on, which is the one thing the catalogue knows and
 *  the list never said out loud.
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
import {
  CircleCheck,
  Crosshair,
  Info,
  MapPin,
  OctagonX,
  TriangleExclamationPoint,
  X,
  type LucideIcon,
} from 'lucide-react-native';

import {
  REPORT_KINDS,
  type ReportKind,
  type ReportSeverity,
} from '../domain/reports';
import { Button } from './forms';
import { reportIcon } from './reportIcons';
import { Palette, SEVERITY_LABEL, severityColour, sp, useTheme } from './theme';

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

/** The three groups, in the order somebody scans them. */
const SEVERITIES: ReportSeverity[] = ['blocking', 'hazard', 'notice'];

/** The glyph that heads each group, so the band is legible without colour. */
const SEVERITY_ICON: Record<ReportSeverity, LucideIcon> = {
  blocking: OctagonX,
  hazard: TriangleExclamationPoint,
  notice: Info,
};

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
  const severity = severityColour(c);

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

  function dismiss() {
    reset();
    onClose();
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

          <View style={s.header}>
            <Text style={s.title}>¿Qué encontraste?</Text>
            <Pressable onPress={dismiss} hitSlop={10} style={s.close} accessibilityLabel="Cerrar">
              <X size={20} color={c.mutedText} strokeWidth={2.2} />
            </Pressable>
          </View>

          <ScrollView
            style={s.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.bodyContent}
          >
            {SEVERITIES.map((level) => {
              const tone = severity[level];
              const Glyph = SEVERITY_ICON[level];
              return (
                <View key={level} style={s.group}>
                  <View style={s.groupHead}>
                    <Glyph size={14} color={tone.ink} strokeWidth={2.4} />
                    <Text style={[s.groupLabel, { color: tone.ink }]}>
                      {SEVERITY_LABEL[level]}
                    </Text>
                  </View>

                  <View style={s.grid}>
                    {REPORT_KINDS.filter((k) => k.severity === level).map((k) => {
                      const on = chosen?.id === k.id;
                      const Mark = reportIcon(k.id);
                      // Blocking is drawn filled and the other two tinted,
                      // so the band reads before the colour does.
                      const filled = level === 'blocking';
                      // The one answered in words lies across the row, which
                      // is both what is left over and what it is.
                      const wide = k.requiresComment === true;
                      return (
                        <Pressable
                          key={k.id}
                          onPress={() => setChosen(k)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          style={[
                            s.kind,
                            wide && s.kindWide,
                            on && { borderColor: tone.ink, borderWidth: 2, backgroundColor: tone.tint },
                          ]}
                        >
                          <View
                            style={[
                              s.badge,
                              wide && s.badgeWide,
                              { backgroundColor: filled ? tone.ink : tone.tint },
                            ]}
                          >
                            <Mark
                              size={20}
                              color={filled ? c.surface : tone.ink}
                              strokeWidth={2.1}
                            />
                          </View>
                          <Text style={[s.kindLabel, on && { color: tone.ink }]}>{k.label}</Text>
                          {on && (
                            <View style={s.tick}>
                              <CircleCheck size={16} color={tone.ink} strokeWidth={2.4} />
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}

            {attempted && chosen === null && (
              <Text style={s.error}>Elegí qué encontraste.</Text>
            )}

            {chosen && (
              <>
                <Text style={s.label}>
                  {needsComment ? '¿Qué pasó?' : 'Algo para agregar (opcional)'}
                </Text>
                <TextInput
                  style={s.input}
                  value={comment}
                  onChangeText={setComment}
                  multiline
                  maxLength={500}
                />
                {attempted && commentMissing && (
                  <Text style={s.error}>Falta contar qué encontraste.</Text>
                )}
              </>
            )}

            <Text style={s.label}>¿Dónde?</Text>
            <View style={s.places}>
              <Pressable
                onPress={onUseCurrentPosition}
                disabled={!hasPosition}
                accessibilityRole="button"
                style={[
                  s.place,
                  place.kind === 'here' && hasPosition && s.placeOn,
                  !hasPosition && s.placeOff,
                ]}
              >
                <Crosshair
                  size={18}
                  color={place.kind === 'here' && hasPosition ? c.primary : c.mutedText}
                  strokeWidth={2.2}
                />
                <Text style={s.placeLabel}>Donde estoy</Text>
                {!hasPosition && <Text style={s.placeDetail}>Sin lectura</Text>}
              </Pressable>

              <Pressable
                onPress={onPickOnMap}
                accessibilityRole="button"
                style={[s.place, place.kind === 'onTrack' && s.placeOn]}
              >
                <MapPin
                  size={18}
                  color={place.kind === 'onTrack' ? c.primary : c.mutedText}
                  strokeWidth={2.2}
                />
                <Text style={s.placeLabel}>Marcar en el mapa</Text>
                {place.kind === 'onTrack' && (
                  <Text style={s.placeDetail}>km {(place.alongM / 1000).toFixed(2)}</Text>
                )}
              </Pressable>
            </View>

            {placeMissing && <Text style={s.error}>Marcá el punto en el mapa.</Text>}
          </ScrollView>

          {/* Outside the scroll, because the way out of this sheet should
              not depend on how far down the list somebody has read. */}
          <View style={s.actions}>
            <Button label="Guardar el aviso" onPress={save} busy={saving} disabled={!ready} />
          </View>
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
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: sp.lg,
      paddingBottom: sp.lg,
      maxHeight: '92%',
    },
    grip: {
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: c.border,
      alignSelf: 'center',
      marginVertical: sp.md,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: sp.md,
      paddingBottom: sp.md,
      borderBottomColor: c.border,
      borderBottomWidth: 1,
    },
    title: { color: c.text, fontSize: 24, fontWeight: '800' },
    close: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },

    body: { flexShrink: 1 },
    bodyContent: { paddingTop: sp.md, paddingBottom: sp.md },

    group: { marginBottom: sp.md },
    groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: sp.sm },
    groupLabel: {
      fontSize: 11.5,
      fontWeight: '800',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm },
    kind: {
      width: '48.5%',
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1.5,
      borderRadius: 18,
      padding: sp.md,
      minHeight: 96,
    },
    kindWide: {
      width: '100%',
      minHeight: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp.md,
    },
    badge: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: sp.sm,
    },
    badgeWide: { marginBottom: 0 },
    kindLabel: { color: c.text, fontWeight: '700', fontSize: 14, lineHeight: 18 },
    tick: { position: 'absolute', top: sp.sm, right: sp.sm },

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
      borderRadius: 16,
      padding: sp.md,
      color: c.text,
      fontSize: 15,
      minHeight: 84,
      textAlignVertical: 'top',
    },
    places: { flexDirection: 'row', gap: sp.sm },
    place: {
      flex: 1,
      gap: 6,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1.5,
      borderRadius: 18,
      padding: sp.md,
    },
    placeOn: { borderColor: c.primary, borderWidth: 2, backgroundColor: c.primarySoft },
    placeOff: { opacity: 0.5 },
    placeLabel: { color: c.text, fontWeight: '700', fontSize: 13.5 },
    placeDetail: { color: c.mutedText, fontSize: 11.5, lineHeight: 16 },
    error: { color: c.danger, fontSize: 12.5, marginTop: sp.sm },

    actions: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      paddingTop: sp.md,
    },
  });
