/** The icons of the tab bar.
 *
 *  Drawn as paths rather than taken from an icon font. An icon font means
 *  another native module in the build, and the application already carries
 *  `react-native-svg` for the track rendering, so these cost nothing new and
 *  keep their stroke weight under our own control.
 *
 *  All of them are drawn inside the same 24 by 24 box with the same stroke,
 *  which is what makes a row of icons look like a set instead of a
 *  collection. The active one is filled softly rather than swapped for a
 *  different shape, so nothing moves when the tab changes.
 */
import Svg, { Circle, Path } from 'react-native-svg';

export interface IconProps {
  colour: string;
  active?: boolean;
  size?: number;
}

const STROKE = 1.8;

function Frame({ size = 24, children }: { size?: number; children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {children}
    </Svg>
  );
}

/** A hut, for the screen the hiker lands on. */
export function HomeIcon({ colour, active, size }: IconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M3.5 10.6 12 3.8l8.5 6.8V20a.9.9 0 0 1-.9.9h-4.4v-6h-6.4v6H4.4a.9.9 0 0 1-.9-.9z"
        fill={active ? colour : 'none'}
        fillOpacity={active ? 0.16 : 0}
        stroke={colour}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
    </Frame>
  );
}

/** A winding path, for the catalogue of trails. */
export function TrailIcon({ colour, active, size }: IconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M5 20c0-4 4.5-3.2 4.5-6.6S5.2 10.4 5.2 7.2 9.4 4 12.6 4H19"
        fill="none"
        stroke={colour}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={active ? undefined : '3.4 2.6'}
      />
      <Circle cx={19} cy={4} r={2.2} fill={active ? colour : 'none'} stroke={colour} strokeWidth={STROKE} />
    </Frame>
  );
}

/** A summit with a trace over it, for what the hiker actually walked. */
export function HikesIcon({ colour, active, size }: IconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M2.6 19.2 9 8.4l3.6 5.6 2.3-3.4 6.5 8.6z"
        fill={active ? colour : 'none'}
        fillOpacity={active ? 0.16 : 0}
        stroke={colour}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <Circle cx={9} cy={8.4} r={1.5} fill={colour} />
    </Frame>
  );
}

/** A person, for the account. */
export function ProfileIcon({ colour, active, size }: IconProps) {
  return (
    <Frame size={size}>
      <Circle
        cx={12}
        cy={8}
        r={3.6}
        fill={active ? colour : 'none'}
        fillOpacity={active ? 0.16 : 0}
        stroke={colour}
        strokeWidth={STROKE}
      />
      <Path
        d="M4.8 20.4c0-3.7 3.2-6.2 7.2-6.2s7.2 2.5 7.2 6.2"
        fill="none"
        stroke={colour}
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </Frame>
  );
}

/** Two arrows chasing each other, for synchronising. */
export function SyncIcon({ colour, size = 16 }: IconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M20 12a8 8 0 0 1-13.7 5.7M4 12a8 8 0 0 1 13.7-5.7"
        fill="none"
        stroke={colour}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <Path d="M6.4 13.6 6 18.4l4.8-.4" fill="none" stroke={colour} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M17.6 10.4 18 5.6l-4.8.4" fill="none" stroke={colour} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

/** A downward arrow into a tray, for what is already on the phone. */
export function OfflineIcon({ colour, size = 16 }: IconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M12 3.4v10.2m0 0 3.6-3.6M12 13.6 8.4 10"
        fill="none"
        stroke={colour}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4.4 16.4v2.4a1.8 1.8 0 0 0 1.8 1.8h11.6a1.8 1.8 0 0 0 1.8-1.8v-2.4"
        fill="none"
        stroke={colour}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </Frame>
  );
}
