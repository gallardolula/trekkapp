/** The pieces every form in the application is built from.
 *
 *  Signing up, signing in and anything asked of the hiker later share these
 *  rather than each screen writing its own. A field that looks slightly
 *  different on one screen reads as a different kind of field, and the one
 *  place that genuinely matters, the primary button, has to be the same
 *  shape everywhere for somebody to stop reading it and just press it.
 */
import { ReactNode, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Palette, sp, useTheme } from './theme';

// --------------------------------------------------------------- buttons --

export interface ButtonProps {
  label: string;
  onPress: () => void;
  /** Secondary buttons are outlined; the primary one is filled. */
  variant?: 'primary' | 'outline' | 'quiet';
  disabled?: boolean;
  busy?: boolean;
  tone?: 'normal' | 'danger';
}

/**
 * The full width button the references all use.
 *
 * Wide and tall on purpose. This is an application used outdoors, often
 * with cold hands or gloves, and a target that is comfortable in a café is
 * not comfortable on a ridge.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  tone = 'normal',
}: ButtonProps) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const accent = tone === 'danger' ? c.danger : c.primary;

  const shape =
    variant === 'primary'
      ? [s.button, { backgroundColor: accent }]
      : variant === 'outline'
        ? [s.button, s.outline, { borderColor: accent }]
        : [s.button, s.quiet];

  return (
    <Pressable
      style={[...shape, (disabled || busy) && s.off]}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
    >
      {busy ? (
        <ActivityIndicator color={variant === 'primary' ? c.onPrimary : accent} />
      ) : (
        <Text
          style={[
            s.buttonText,
            { color: variant === 'primary' ? c.onPrimary : accent },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------- fields --

export interface FieldProps extends TextInputProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  error?: string | null;
  /** Adds the eye that reveals what was typed. */
  secret?: boolean;
  /** Adds the cross that empties the field, as komoot does. */
  clearable?: boolean;
}

export function Field({
  label,
  value,
  onChangeText,
  error,
  secret,
  clearable,
  ...rest
}: FieldProps) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <View style={s.fieldBlock}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View
        style={[
          s.fieldBox,
          focused && { borderColor: c.primary, borderWidth: 2 },
          error && { borderColor: c.danger },
        ]}
      >
        <TextInput
          style={s.input}
          value={value}
          onChangeText={onChangeText}
          placeholderTextColor={c.mutedText}
          secureTextEntry={secret && !revealed}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
        />
        {secret && (
          <Pressable
            onPress={() => setRevealed((r) => !r)}
            hitSlop={10}
            accessibilityLabel={revealed ? 'Ocultar la contraseña' : 'Ver la contraseña'}
          >
            <EyeIcon colour={c.mutedText} closed={!revealed} />
          </Pressable>
        )}
        {clearable && value.length > 0 && !secret && (
          <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityLabel="Borrar">
            <ClearIcon colour={c.mutedText} />
          </Pressable>
        )}
      </View>
      {error && <Text style={s.fieldError}>{error}</Text>}
    </View>
  );
}

function EyeIcon({ colour, closed }: { colour: string; closed: boolean }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path
        d={
          closed
            ? 'M3.5 9.5c2.2 3.4 5.2 5.1 8.5 5.1s6.3-1.7 8.5-5.1M6 13.4 4.3 16M12 14.6V17.6M18 13.4 19.7 16'
            : 'M2.6 12S6.3 5.8 12 5.8 21.4 12 21.4 12 17.7 18.2 12 18.2 2.6 12 2.6 12Z'
        }
        fill="none"
        stroke={colour}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {!closed && (
        <Path
          d="M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z"
          fill="none"
          stroke={colour}
          strokeWidth={1.8}
        />
      )}
    </Svg>
  );
}

function ClearIcon({ colour }: { colour: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path
        d="M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8Z"
        fill="none"
        stroke={colour}
        strokeWidth={1.8}
      />
      <Path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" stroke={colour} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

// ----------------------------------------------------------------- steps --

/**
 * How far through a sequence of questions somebody is.
 *
 * Asking one thing at a time is what the applications this is modelled on
 * do, and it only works if the person can see that it ends. Without the
 * bar, a form that reveals itself one question at a time feels endless.
 */
export function StepBar({ step, of }: { step: number; of: number }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 4, marginBottom: sp.xl }}>
      {Array.from({ length: of }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor: i <= step ? c.primary : c.border,
          }}
        />
      ))}
    </View>
  );
}

/** The large question at the head of a step. */
export function Question({ title, detail }: { title: string; detail?: ReactNode }) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  return (
    <View style={{ marginBottom: sp.lg }}>
      <Text style={s.question}>{title}</Text>
      {detail && <Text style={s.questionDetail}>{detail}</Text>}
    </View>
  );
}

/** The message a server failure leaves on a form. */
export function Notice({ text, tone }: { text: string; tone: 'danger' | 'warning' }) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  return (
    <Text
      style={[
        s.notice,
        tone === 'danger'
          ? { color: c.danger, backgroundColor: c.dangerSoft }
          : { color: c.warning, backgroundColor: c.warningSoft },
      ]}
    >
      {text}
    </Text>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    button: {
      borderRadius: 28,
      paddingVertical: 17,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 56,
    },
    outline: { borderWidth: 1.5, backgroundColor: 'transparent' },
    quiet: { backgroundColor: 'transparent' },
    off: { opacity: 0.45 },
    buttonText: { fontWeight: '700', fontSize: 16 },

    fieldBlock: { marginBottom: sp.md },
    fieldLabel: { color: c.text, fontWeight: '600', fontSize: 14, marginBottom: sp.sm },
    fieldBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp.sm,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1.5,
      borderRadius: 14,
      paddingHorizontal: sp.lg,
      minHeight: 56,
    },
    input: { flex: 1, color: c.text, fontSize: 16, paddingVertical: 14 },
    fieldError: { color: c.danger, fontSize: 12.5, marginTop: sp.xs, marginLeft: sp.xs },

    question: { color: c.text, fontSize: 28, fontWeight: '800', lineHeight: 34 },
    questionDetail: { color: c.mutedText, fontSize: 14.5, lineHeight: 21, marginTop: sp.sm },

    notice: {
      borderRadius: 12,
      padding: sp.md,
      marginBottom: sp.md,
      fontSize: 13,
      lineHeight: 19,
    },
  });
