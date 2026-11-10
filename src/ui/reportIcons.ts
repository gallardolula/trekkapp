/** One drawing per kind of report.
 *
 *  Kept beside the palette rather than inside the screen that leaves a
 *  report, because the sheet that writes one and every list that shows one
 *  have to agree. A ford drawn as rising water on one screen and as a
 *  generic marker on the next reads as two different things.
 *
 *  Keyed by the stable identifier and not by the label, so the wording on
 *  screen can change without the drawings moving, and a kind this version
 *  has never heard of falls back instead of rendering nothing.
 */
import {
  DropletOff,
  Fence,
  Footprints,
  MessageSquare,
  PawPrint,
  Signpost,
  WavesArrowUp,
  type LucideIcon,
} from 'lucide-react-native';

const ICONS: Record<string, LucideIcon> = {
  path_blocked: Fence,
  flooded_ford: WavesArrowUp,
  lost_markings: Signpost,
  loose_terrain: Footprints,
  no_water: DropletOff,
  livestock: PawPrint,
  other: MessageSquare,
};

/** The drawing for a kind, or the one that stands for anything written. */
export function reportIcon(id: string): LucideIcon {
  return ICONS[id] ?? MessageSquare;
}
