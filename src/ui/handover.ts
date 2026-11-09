/** Handing the device from one account to another.
 *
 *  Shared by signing in and signing up, because both can happen on a phone
 *  that is already holding somebody else's data, and both have to say the
 *  same thing about it. The clearing itself is `adoptAccount` in the data
 *  layer; what lives here is asking first.
 */
import { Alert } from 'react-native';

export const HANDOVER_WARNING =
  'Este teléfono tiene los datos de otra cuenta. Al continuar se van a borrar sus recorridos y ' +
  'los reportes que todavía no se enviaron, porque de otro modo se enviarían a tu nombre. Los ' +
  'senderos descargados se conservan.';

/**
 * Asks before clearing another account's data. Resolves to false on cancel.
 *
 * A confirmation and not a notice: the walks of somebody who lent their
 * phone are not recoverable from anywhere, so this is the last moment they
 * exist.
 */
export function confirmHandover(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert('Hay otra cuenta en este teléfono', HANDOVER_WARNING, [
      { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Continuar', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

/** Told after the fact, when the device held a profile with no address. */
export function reportHandover(): void {
  Alert.alert('Se borraron los datos de la cuenta anterior', HANDOVER_WARNING);
}
