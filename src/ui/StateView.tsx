/** What a screen shows when it has nothing to show.
 *
 *  An empty list, a failed request and a section that needs something done
 *  first are all the same shape: a drawing, one sentence saying what
 *  happened in plain words, and the one action that changes it. Sentences
 *  dropped in the middle of a screen read as something broken even when
 *  nothing is, and they never say what to do next.
 *
 *  The drawings are paths rather than images, so they follow the palette,
 *  weigh nothing, and are there with no connection, which is the state
 *  half of them exist to describe.
 */
import { ReactNode, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Polyline } from 'react-native-svg';

import { Palette, sp, useTheme } from './theme';

export type StateKind = 'offline' | 'empty' | 'failed' | 'waiting';

export interface StateViewProps {
  kind: StateKind;
  title: string;
  /** One or two sentences. What happened, and what it means for them. */
  detail?: string;
  action?: { label: string; onPress: () => void };
  /** A quieter second way out, when there is one. */
  secondary?: { label: string; onPress: () => void };
  /** Shown under the action, for anything that needs saying once. */
  footnote?: ReactNode;
  /** Narrower, for a state that lives inside a section of a longer page. */
  compact?: boolean;
}

export function StateView({
  kind,
  title,
  detail,
  action,
  secondary,
  footnote,
  compact = false,
}: StateViewProps) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const size = compact ? 72 : 108;

  return (
    <View style={[s.block, compact && s.compact]}>
      <Drawing kind={kind} colours={c} size={size} />
      <Text style={[s.title, compact && s.titleCompact]}>{title}</Text>
      {detail && <Text style={s.detail}>{detail}</Text>}

      {action && (
        <Pressable style={s.action} onPress={action.onPress}>
          <Text style={s.actionText}>{action.label}</Text>
        </Pressable>
      )}
      {secondary && (
        <Pressable onPress={secondary.onPress} hitSlop={8}>
          <Text style={s.secondary}>{secondary.label}</Text>
        </Pressable>
      )}
      {footnote && <Text style={s.footnote}>{footnote}</Text>}
    </View>
  );
}

/** The four drawings, each one about the state it belongs to. */
function Drawing({ kind, colours, size }: { kind: StateKind; colours: Palette; size: number }) {
  const ink = colours.mutedText;
  const accent = kind === 'failed' ? colours.danger : colours.primary;
  const stroke = 2.4;

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      {kind === 'offline' && (
        <>
          {/* A ridge with the signal arcs crossed out over it. */}
          <Polyline
            points="4,46 18,26 27,38 36,22 60,46"
            fill="none"
            stroke={ink}
            strokeWidth={stroke}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <Path
            d="M20 18a16 16 0 0 1 24 0"
            fill="none"
            stroke={accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            opacity={0.45}
          />
          <Line
            x1={14}
            y1={8}
            x2={50}
            y2={30}
            stroke={accent}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        </>
      )}

      {kind === 'empty' && (
        <>
          {/* An empty pack. Nothing has been put in it yet. */}
          <Path
            d="M18 24h28v28a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4z"
            fill="none"
            stroke={ink}
            strokeWidth={stroke}
            strokeLinejoin="round"
          />
          <Path
            d="M26 24v-6a6 6 0 0 1 12 0v6"
            fill="none"
            stroke={accent}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          <Line x1={18} y1={36} x2={46} y2={36} stroke={ink} strokeWidth={stroke} opacity={0.4} />
        </>
      )}

      {kind === 'failed' && (
        <>
          {/* A path that stops short. */}
          <Path
            d="M10 54c0-12 14-10 14-20S12 24 12 14"
            fill="none"
            stroke={ink}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray="4 3"
          />
          <Circle cx={44} cy={30} r={13} fill="none" stroke={accent} strokeWidth={stroke} />
          <Line
            x1={39}
            y1={25}
            x2={49}
            y2={35}
            stroke={accent}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          <Line
            x1={49}
            y1={25}
            x2={39}
            y2={35}
            stroke={accent}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        </>
      )}

      {kind === 'waiting' && (
        <>
          {/* Two arrows going round, the shape of a synchronisation. */}
          <Path
            d="M50 32a18 18 0 0 1-30 13M14 32a18 18 0 0 1 30-13"
            fill="none"
            stroke={accent}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          <Path
            d="M18 36 17 48l12-2"
            fill="none"
            stroke={accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M46 28 47 16l-12 2"
            fill="none"
            stroke={accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </Svg>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    block: { alignItems: 'center', paddingVertical: sp.xl, paddingHorizontal: sp.lg },
    compact: { paddingVertical: sp.lg },
    title: {
      color: c.text,
      fontSize: 17,
      fontWeight: '700',
      textAlign: 'center',
      marginTop: sp.md,
    },
    titleCompact: { fontSize: 15 },
    detail: {
      color: c.mutedText,
      fontSize: 13.5,
      lineHeight: 20,
      textAlign: 'center',
      marginTop: sp.sm,
      maxWidth: 320,
    },
    action: {
      backgroundColor: c.primary,
      borderRadius: 24,
      paddingVertical: 13,
      paddingHorizontal: sp.xl,
      marginTop: sp.lg,
    },
    actionText: { color: c.onPrimary, fontWeight: '700', fontSize: 14.5 },
    secondary: { color: c.primary, fontWeight: '700', fontSize: 13.5, marginTop: sp.md },
    footnote: {
      color: c.mutedText,
      fontSize: 11.5,
      lineHeight: 16,
      textAlign: 'center',
      marginTop: sp.md,
      maxWidth: 320,
    },
  });
