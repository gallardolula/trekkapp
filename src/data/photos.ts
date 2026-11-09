/** Photographs of your own walk.
 *
 *  Taken during a hike and kept on the phone that took them. They are not
 *  sent anywhere, not attached to a report, and not visible to anybody
 *  else, and that is the whole design rather than a stage of it.
 *
 *  It is also what makes them possible at all here. A trail is geometry
 *  and a machine can check everything that matters about it, which is why
 *  contributed trails are validated and published without a moderator. A
 *  photograph is content: no simple code can tell whether it shows the
 *  path, somebody who did not agree to be in it, or something nobody
 *  should see. Shared photographs would need a moderator this system does
 *  not have. Private ones need none, because there is no audience to
 *  protect. See docs/adr/0008.
 *
 *  The file is copied out of the camera's temporary directory into the
 *  application's own, because what the picker hands over is cleaned up by
 *  the operating system whenever it feels like it, and a gallery of
 *  missing files is worse than no gallery.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { listPhotos, savePhoto, type HikePhoto } from './db';
import type { Point } from '../domain/types';

/** Where the photographs of every walk are kept. */
const FOLDER = 'hike-photos';

/**
 * The camera, or null in a build that does not carry it.
 *
 * Required at runtime inside a try, the same way the map is, because a
 * plain import of a native module throws while the module is being
 * evaluated. That is not an error the screen importing it can catch: it
 * takes the whole file down, and with it every screen that touches
 * anything in it. Writing a photograph, listing one and deleting its file
 * need no camera at all, and a build without one went from losing a
 * button to losing the history and the walk screen entirely.
 */
const picker: typeof import('expo-image-picker') | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-image-picker') as typeof import('expo-image-picker');
  } catch {
    return null;
  }
})();

/** Whether this build can take a photograph at all. */
export const cameraAvailable = () => picker !== null;

export class CameraRefused extends Error {
  constructor() {
    super('sin permiso de cámara');
    this.name = 'CameraRefused';
  }
}

export class CameraMissing extends Error {
  constructor() {
    super('esta compilación no incluye la cámara');
    this.name = 'CameraMissing';
  }
}

function folder(): Directory {
  const directory = new Directory(Paths.document, FOLDER);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

/**
 * Takes a photograph and keeps it with the walk.
 *
 * Returns null when the hiker backed out of the camera, which is not a
 * failure and should leave no trace.
 *
 * The quality is deliberately below the camera's best. These are read on
 * the phone that took them, a walk produces dozens, and the difference
 * between two megabytes and eight is invisible on a screen and very
 * visible in the storage of somebody who walks every weekend.
 */
export async function capturePhoto(
  hikeId: string,
  at: Point | null,
): Promise<HikePhoto | null> {
  if (!picker) throw new CameraMissing();

  const permission = await picker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new CameraRefused();

  const taken = await picker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.6,
    exif: false,
  });
  if (taken.canceled || !taken.assets[0]) return null;

  const source = new File(taken.assets[0].uri);
  const target = new File(folder(), `${Date.now()}.jpg`);
  source.copy(target);

  const id = await savePhoto({
    hikeId,
    uri: target.uri,
    ...(at ? { lat: at.lat, lon: at.lon } : {}),
  });

  return {
    id,
    hikeId,
    uri: target.uri,
    takenAt: new Date().toISOString(),
    ...(at ? { lat: at.lat, lon: at.lon } : {}),
  };
}

/** Removes the file a forgotten photograph left behind. */
export function deleteFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A file already gone is the state we wanted. Anything else is a
    // photograph taking up room, which is not worth failing a delete over.
  }
}

export { listPhotos };
export type { HikePhoto };
